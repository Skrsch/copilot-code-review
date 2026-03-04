// @ts-check

(function () {
    const vscode = acquireVsCodeApi();

    // DOM elements
    const baseBranchButton = document.getElementById('baseBranch');
    const targetBranchButton = document.getElementById('targetBranch');
    const baseBranchText = document.getElementById('baseBranchText');
    const targetBranchText = document.getElementById('targetBranchText');
    const reviewButtons = document.getElementById('reviewButtons');
    const mainButton = document.getElementById('mainButton');
    const mainArea = document.getElementById('mainArea');
    const chevronArea = document.getElementById('chevronArea');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const dropdownArrow = document.getElementById('dropdownArrow');
    const previewSection = document.getElementById('previewSection');
    const previewFiles = document.getElementById('previewFiles');
    const statusSection = document.getElementById('statusSection');
    const statusMessage = document.getElementById('statusMessage');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const resultsSection = document.getElementById('resultsSection');
    const reviewResults = document.getElementById('reviewResults');
    const reviewStatus = document.getElementById('reviewStatus');
    const reviewStatusText = document.getElementById('reviewStatusText');
    const reviewSummary = document.getElementById('reviewSummary');
    const reviewModeValue = document.getElementById('reviewModeValue');
    const reviewModelValue = document.getElementById('reviewModelValue');
    const repositoryPathValue = document.getElementById('repositoryPathValue');
    const selectModelButton = document.getElementById('selectModelButton');
    const selectModeButton = document.getElementById('selectModeButton');
    const selectRepositoryButton = document.getElementById('selectRepositoryButton');
    const incrementalToggle = document.getElementById('incrementalToggle');
    const hideTriagedToggle = document.getElementById('hideTriagedToggle');
    const quickReviewAnyButton = document.getElementById('quickReviewAnyButton');
    const quickReviewBranchButton = document.getElementById('quickReviewBranchButton');
    const quickReviewCommitButton = document.getElementById('quickReviewCommitButton');
    const startQuickReviewButton = document.getElementById('startQuickReviewButton');

    let currentBranches = [];
    let selectedBaseBranch = '';
    let selectedTargetBranch = '';
    let isReviewing = false;
    let isDropdownOpen = false;
    let currentResults = [];
    let currentSummary = null;
    let isChatReviewMode = false; // Flag to indicate we're displaying chat review results
    let hasPendingQuickReview = false;
    let pendingQuickReviewDescription = '';
    let areQuickActionsDisabled = false;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lastProgressRatio = 0;
    let progressHideTimeout = null;

    // Initialize
    window.addEventListener('load', () => {
        setupEventListeners();
        loadReviewSettings();
        loadBranches();
        updateStartQuickReviewButton();
    });

    function setupEventListeners() {
        // Section collapse/expand functionality
        setupSectionCollapse();

        selectModeButton?.addEventListener('click', () => {
            if (!isReviewing) {
                vscode.postMessage({ type: 'selectReviewMode' });
            }
        });

        selectModelButton?.addEventListener('click', () => {
            if (!isReviewing) {
                vscode.postMessage({ type: 'selectChatModel' });
            }
        });

        selectRepositoryButton?.addEventListener('click', () => {
            if (!isReviewing) {
                vscode.postMessage({ type: 'selectRepository' });
            }
        });

        incrementalToggle?.addEventListener('change', () => {
            vscode.postMessage({
                type: 'setIncrementalReReview',
                enabled: !!incrementalToggle.checked,
            });
        });

        hideTriagedToggle?.addEventListener('change', () => {
            vscode.postMessage({
                type: 'setHideTriagedFindings',
                enabled: !!hideTriagedToggle.checked,
            });
        });

        quickReviewAnyButton?.addEventListener('click', () => {
            if (!isReviewing) {
                vscode.postMessage({ type: 'quickReview', reviewKind: 'review' });
            }
        });

        quickReviewBranchButton?.addEventListener('click', () => {
            if (!isReviewing) {
                vscode.postMessage({ type: 'quickReview', reviewKind: 'branch' });
            }
        });

        quickReviewCommitButton?.addEventListener('click', () => {
            if (!isReviewing) {
                vscode.postMessage({ type: 'quickReview', reviewKind: 'commit' });
            }
        });

        startQuickReviewButton?.addEventListener('click', () => {
            if (!isReviewing && hasPendingQuickReview) {
                vscode.postMessage({ type: 'startQuickReview' });
            }
        });
        
        // Branch selection
        baseBranchButton?.addEventListener('click', () => {
            if (!isReviewing) {
                vscode.postMessage({ type: 'selectBaseBranch' });
            }
        });
        
        targetBranchButton?.addEventListener('click', () => {
            if (!isReviewing) {
                vscode.postMessage({ type: 'selectTargetBranch' });
            }
        });

        // Dropdown functionality
        if (mainArea) {
            mainArea.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!isReviewing && !mainButton?.classList.contains('disabled')) {
                    startReview('committed');
                }
            });
        }

        if (chevronArea) {
            chevronArea.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!mainButton?.classList.contains('disabled')) {
                    toggleDropdown();
                }
            });
        }

        // Dropdown options
        const dropdownOptions = document.querySelectorAll('.dropdown-option');
        dropdownOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = option.getAttribute('data-action');
                if (action && !isReviewing && !mainButton?.classList.contains('disabled')) {
                    startReview(action);
                }
                closeDropdown();
            });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            if (isDropdownOpen) {
                closeDropdown();
            }
        });

        // Prevent dropdown from closing when clicking inside it
        if (dropdownMenu) {
            dropdownMenu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            handleMessage(message);
        });
    }

    function setupSectionCollapse() {
        // Add click listeners to all section headers
        const sectionHeaders = document.querySelectorAll('.section-header');
        sectionHeaders.forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const sectionId = header.getAttribute('data-section');
                if (sectionId) {
                    toggleSection(sectionId);
                }
            });
        });
    }

    function toggleSection(sectionId) {
        const section = document.getElementById(sectionId);
        const header = section?.querySelector('.section-header');
        const content = section?.querySelector('.section-content');
        const chevron = header?.querySelector('.section-chevron');
        
        if (!section || !header || !content || !chevron) {
            console.warn('Section elements not found for:', sectionId);
            return;
        }
        
        const isCollapsed = section.classList.contains('collapsed');
        
        if (isCollapsed) {
            // Expand section
            section.classList.remove('collapsed');
            content.classList.remove('collapsed');
            chevron.classList.remove('collapsed');
            console.log('Expanded section:', sectionId);
        } else {
            // Collapse section
            section.classList.add('collapsed');
            content.classList.add('collapsed');
            chevron.classList.add('collapsed');
            console.log('Collapsed section:', sectionId);
        }
    }

    function expandSection(sectionId) {
        const section = document.getElementById(sectionId);
        const header = section?.querySelector('.section-header');
        const content = section?.querySelector('.section-content');
        const chevron = header?.querySelector('.section-chevron');
        
        if (section && header && content && chevron) {
            section.classList.remove('collapsed');
            content.classList.remove('collapsed');
            chevron.classList.remove('collapsed');
            console.log('Force expanded section:', sectionId);
        }
    }

    function collapseSection(sectionId) {
        const section = document.getElementById(sectionId);
        const header = section?.querySelector('.section-header');
        const content = section?.querySelector('.section-content');
        const chevron = header?.querySelector('.section-chevron');
        
        if (section && header && content && chevron) {
            section.classList.add('collapsed');
            content.classList.add('collapsed');
            chevron.classList.add('collapsed');
            console.log('Force collapsed section:', sectionId);
        }
    }

    function toggleDropdown() {
        isDropdownOpen = !isDropdownOpen;
        
        if (isDropdownOpen) {
            dropdownMenu?.classList.add('show');
            mainButton?.classList.add('expanded');
            dropdownArrow?.classList.add('expanded');
        } else {
            dropdownMenu?.classList.remove('show');
            mainButton?.classList.remove('expanded');
            dropdownArrow?.classList.remove('expanded');
        }
    }

    function closeDropdown() {
        isDropdownOpen = false;
        dropdownMenu?.classList.remove('show');
        mainButton?.classList.remove('expanded');
        dropdownArrow?.classList.remove('expanded');
    }

    function loadBranches() {
        // Reset chat review mode when loading branches (indicates user interaction)
        if (isChatReviewMode) {
            console.log('Resetting chat review mode - user is interacting with branch selection');
            isChatReviewMode = false;
            
            // Show branch comparison section again
            const branchComparisonSection = document.getElementById('branchComparisonSection');
            branchComparisonSection?.classList.remove('hidden');
            
            // Ensure branch comparison section is expanded
            expandSection('branchComparisonSection');
        }
        
        vscode.postMessage({ type: 'getBranches' });
    }

    function loadReviewSettings() {
        vscode.postMessage({ type: 'getReviewSettings' });
    }

    function formatBranchDisplay(branchName) {
        if (!branchName) return branchName;
        
        // Check if branch starts with remote/origin prefixes
        const remoteOriginPrefixes = ['remote/origin/', 'remotes/origin/', 'origin/'];
        let isRemote = false;
        let displayName = branchName;
        
        for (const prefix of remoteOriginPrefixes) {
            if (branchName.startsWith(prefix)) {
                isRemote = true;
                displayName = branchName.substring(prefix.length);
                break;
            }
        }
        
        if (isRemote) {
            // Return HTML with cloud icon for remote branches
            return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-cloud" style="margin-right: 4px; vertical-align: middle;"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878" /></svg><span style="vertical-align: middle;">${displayName}</span>`;
        }
        
        // Return plain text for local branches
        return `<span>${displayName}</span>`;
    }

    function handleMessage(message) {
        console.log('WebView received message:', message.type, message);
        switch (message.type) {
            case 'reviewSettingsLoaded':
                updateReviewSettings(message);
                break;
            case 'branchesLoaded':
                populateBranches(message.branches, message.currentBranch, message.defaultBase);
                break;
            case 'baseBranchSelected':
                selectedBaseBranch = message.branch;
                if (baseBranchText) {
                    baseBranchText.innerHTML = formatBranchDisplay(message.branch);
                }
                if (baseBranchButton) {
                    baseBranchButton.title = message.branch;
                }
                updateReviewButtons();
                break;
            case 'targetBranchSelected':
                selectedTargetBranch = message.branch;
                if (targetBranchText) {
                    targetBranchText.innerHTML = formatBranchDisplay(message.branch);
                }
                if (targetBranchButton) {
                    targetBranchButton.title = message.branch;
                }
                updateReviewButtons();
                break;
            case 'filesListLoaded':
                handleFilesListLoaded(message.files, message.baseBranch, message.targetBranch);
                break;
            case 'reviewStarted':
                handleReviewStarted();
                break;
            case 'triggerBranchReview':
                triggerBranchReview(message.reviewType);
                break;
            case 'quickReviewPrepared':
                handleQuickReviewPrepared(message.description);
                break;
            case 'quickReviewCleared':
                handleQuickReviewCleared();
                break;
            case 'chatReviewDisplaying':
                handleChatReviewDisplaying();
                break;
            case 'reviewProgress':
                handleReviewProgress(message.message);
                break;
            case 'fileReviewCompleted':
                handleFileReviewCompleted(message.fileResult);
                break;
            case 'reviewCompleted':
                handleReviewCompleted(message.results, message.errors, message.summary);
                break;
            case 'triageStatusUpdated':
                handleTriageStatusUpdated(message.findingId, message.status);
                break;
            case 'reviewError':
                handleReviewError(message.message);
                break;
            case 'error':
                showError(message.message);
                break;
        }
    }

    function populateBranches(branches, currentBranch, defaultBase) {
        currentBranches = branches;

        // Set defaults
        if (currentBranch) {
            selectedTargetBranch = currentBranch;
            if (targetBranchText) {
                targetBranchText.innerHTML = formatBranchDisplay(currentBranch);
            }
            if (targetBranchButton) {
                targetBranchButton.title = currentBranch;
            }
        }
        if (defaultBase) {
            selectedBaseBranch = defaultBase;
            if (baseBranchText) {
                baseBranchText.innerHTML = formatBranchDisplay(defaultBase);
            }
            if (baseBranchButton) {
                baseBranchButton.title = defaultBase;
            }
        }

        updateReviewButtons();
    }

    function updateReviewSettings(message) {
        const reviewMode = message.reviewMode || 'general';
        const reviewModeLabel = message.reviewModeLabel || reviewMode;
        const chatModelLabel = message.chatModelLabel || message.chatModel || 'gpt-4o';
        const repositoryPath = message.repositoryPath || '(workspace root)';
        const incrementalReReview = !!message.incrementalReReview;
        const hideTriagedFindings = !!message.hideTriagedFindings;

        if (reviewModeValue) {
            reviewModeValue.textContent = reviewModeLabel;
            reviewModeValue.setAttribute('data-mode', reviewMode);
        }
        if (reviewModelValue) {
            reviewModelValue.textContent = chatModelLabel;
            reviewModelValue.title = chatModelLabel;
        }
        if (repositoryPathValue) {
            repositoryPathValue.textContent = repositoryPath;
            repositoryPathValue.title = repositoryPath;
        }
        if (incrementalToggle) {
            incrementalToggle.checked = incrementalReReview;
        }
        if (hideTriagedToggle) {
            hideTriagedToggle.checked = hideTriagedFindings;
        }
        applyTriagedVisibility();
    }

    function handleQuickReviewPrepared(description) {
        hasPendingQuickReview = true;
        pendingQuickReviewDescription = description || '';
        updateStartQuickReviewButton();
    }

    function handleQuickReviewCleared() {
        hasPendingQuickReview = false;
        pendingQuickReviewDescription = '';
        updateStartQuickReviewButton();
    }

    function updateStartQuickReviewButton() {
        if (!startQuickReviewButton) {
            return;
        }

        const disabled = areQuickActionsDisabled || !hasPendingQuickReview;
        startQuickReviewButton.disabled = disabled;
        startQuickReviewButton.classList.toggle('disabled', disabled);
        startQuickReviewButton.title = hasPendingQuickReview
            ? `Start review for ${pendingQuickReviewDescription || 'selected scope'}`
            : 'Pick refs, branches, or a commit first';
    }

    function setProgress(ratio) {
        if (!progressBar || !progressFill) {
            return;
        }

        const bounded = Math.max(0, Math.min(1, ratio));
        lastProgressRatio = bounded;
        progressBar.classList.remove('hidden');
        progressFill.style.width = `${Math.round(bounded * 100)}%`;
    }

    function updateProgressFromMessage(message) {
        if (!message) {
            return;
        }

        const match = message.match(/Processed\s+(\d+)\/(\d+)\s+files/i);
        if (!match) {
            return;
        }

        const processed = Number.parseInt(match[1], 10);
        const total = Number.parseInt(match[2], 10);
        if (!Number.isFinite(processed) || !Number.isFinite(total) || total <= 0) {
            return;
        }

        // Keep small headroom until completion is confirmed.
        const ratio = Math.min(0.96, processed / total);
        setProgress(ratio);
    }

    function animateResultCards() {
        if (!reviewResults) {
            return;
        }

        const cards = reviewResults.querySelectorAll('.result-file');
        let staggerIndex = 0;
        cards.forEach(card => {
            if (card.getAttribute('data-animated') === '1') {
                return;
            }
            card.setAttribute('data-animated', '1');
            card.style.setProperty('--cr-stagger', `${staggerIndex * 80}ms`);
            staggerIndex += 1;

            if (prefersReducedMotion) {
                card.classList.add('is-visible');
                return;
            }

            card.classList.add('result-file-enter');
            requestAnimationFrame(() => {
                card.classList.add('is-visible');
            });
        });
    }

    function pulseSummaryCard() {
        if (!reviewSummary || reviewSummary.classList.contains('hidden')) {
            return;
        }
        if (prefersReducedMotion) {
            return;
        }

        reviewSummary.classList.remove('summary-pop');
        // Force reflow so the animation can retrigger.
        void reviewSummary.offsetWidth;
        reviewSummary.classList.add('summary-pop');
    }

    function updateReviewButtons() {
        // Don't update UI if we're in chat review mode
        if (isChatReviewMode) {
            console.log('Skipping updateReviewButtons - in chat review mode');
            return;
        }
        
        const baseBranch = selectedBaseBranch;
        const targetBranch = selectedTargetBranch;
        
        if (baseBranch && targetBranch && baseBranch !== targetBranch) {
            reviewButtons?.classList.remove('hidden');
            requestFilesList(baseBranch, targetBranch);
        } else {
            reviewButtons?.classList.add('hidden');
            previewSection?.classList.add('hidden');
            statusSection?.classList.add('hidden');
            resultsSection?.classList.add('hidden');
        }
    }

    function requestFilesList(baseBranch, targetBranch) {
        vscode.postMessage({
            type: 'getFilesList',
            baseBranch: baseBranch,
            targetBranch: targetBranch,
            reviewType: 'committed' // Default to committed for preview
        });
    }

    function triggerBranchReview(reviewType) {
        if (isReviewing) {
            return;
        }

        if (isChatReviewMode) {
            isChatReviewMode = false;
            const branchComparisonSection = document.getElementById('branchComparisonSection');
            branchComparisonSection?.classList.remove('hidden');
            expandSection('branchComparisonSection');
        }

        if (
            !selectedBaseBranch ||
            !selectedTargetBranch ||
            selectedBaseBranch === selectedTargetBranch
        ) {
            showError('Select base and target branches in the sidebar before starting this review.');
            return;
        }

        startReview(reviewType === 'all' ? 'all' : 'committed');
    }

    function disableBranchSelectors() {
        if (baseBranchButton) {
            baseBranchButton.classList.add('disabled');
            baseBranchButton.style.opacity = '0.6';
            baseBranchButton.style.cursor = 'not-allowed';
        }
        if (targetBranchButton) {
            targetBranchButton.classList.add('disabled');
            targetBranchButton.style.opacity = '0.6';
            targetBranchButton.style.cursor = 'not-allowed';
        }
    }

    function enableBranchSelectors() {
        if (baseBranchButton) {
            baseBranchButton.classList.remove('disabled');
            baseBranchButton.style.opacity = '';
            baseBranchButton.style.cursor = '';
        }
        if (targetBranchButton) {
            targetBranchButton.classList.remove('disabled');
            targetBranchButton.style.opacity = '';
            targetBranchButton.style.cursor = '';
        }
    }

    function setQuickActionsDisabled(disabled) {
        areQuickActionsDisabled = disabled;
        [
            selectModelButton,
            selectModeButton,
            selectRepositoryButton,
            quickReviewAnyButton,
            quickReviewBranchButton,
            quickReviewCommitButton,
        ].forEach(button => {
            if (!button) {
                return;
            }
            button.disabled = disabled;
            button.classList.toggle('disabled', disabled);
        });

        if (incrementalToggle) {
            incrementalToggle.disabled = disabled;
        }
        if (hideTriagedToggle) {
            hideTriagedToggle.disabled = disabled;
        }
        updateStartQuickReviewButton();
    }

    function handleFilesListLoaded(files, baseBranch, targetBranch) {
        // Don't update UI if we're in chat review mode
        if (isChatReviewMode) {
            console.log('Skipping handleFilesListLoaded - in chat review mode');
            return;
        }
        
        previewSection?.classList.remove('hidden');
        
        if (!files || files.length === 0) {
            if (previewFiles) {
                previewFiles.innerHTML = `
                    <div class="file-item">No files changed between <strong>${baseBranch}</strong> and <strong>${targetBranch}</strong></div>
                `;
            }
            return;
        }

        let html = `<div class="file-item" style="display:block;">Reviewing changes from <strong>${baseBranch}</strong> to <strong>${targetBranch}</strong></div>`;
        
        files.forEach(file => {
            const fileName = getFileName(file.name);
            const statusClass = getStatusClass(file.status);
            const fileIcon = getFileIcon();
            html += `<div class="file-item clickable-file ${statusClass}" data-file-path="${escapeHtml(file.name)}" data-base-branch="${escapeHtml(baseBranch)}" data-target-branch="${escapeHtml(targetBranch)}" title="Click to view diff">${fileIcon}${fileName}</div>`;
        });
        
        html += `<div class="file-item">Click a review button to start analysis...</div>`;
        
        if (previewFiles) {
            previewFiles.innerHTML = html;
            
            // Add click event listeners to file items
            const clickableFiles = previewFiles.querySelectorAll('.clickable-file[data-file-path]');
            clickableFiles.forEach(fileElement => {
                fileElement.addEventListener('click', () => {
                    const filePath = fileElement.getAttribute('data-file-path');
                    const baseBranch = fileElement.getAttribute('data-base-branch');
                    const targetBranch = fileElement.getAttribute('data-target-branch');
                    
                    if (filePath && baseBranch && targetBranch) {
                        console.log('File clicked:', { filePath, baseBranch, targetBranch });
                        vscode.postMessage({
                            type: 'openFileDiff',
                            filePath: filePath,
                            baseBranch: baseBranch,
                            targetBranch: targetBranch
                        });
                    }
                });
            });
        }
    }

    function getFileName(filePath) {
        // Extract just the filename from the full path
        const parts = filePath.split('/');
        return parts[parts.length - 1];
    }

    function getStatusClass(status) {
        switch (status) {
            case 'A': return 'status-added';    // Added
            case 'M': return 'status-modified'; // Modified  
            case 'D': return 'status-deleted';  // Deleted
            case 'R': return 'status-renamed';  // Renamed
            case 'C': return 'status-copied';   // Copied
            default: return '';
        }
    }

    function getFileIcon() {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" /></svg>`;
    }

    function startReview(reviewType) {
        const baseBranch = selectedBaseBranch;
        const targetBranch = selectedTargetBranch;

        if (!baseBranch || !targetBranch) {
            showError('Please select both base and target branches');
            return;
        }

        isReviewing = true;
        if (mainButton) mainButton.classList.add('disabled');

        vscode.postMessage({
            type: 'reviewChanges',
            baseBranch: baseBranch,
            targetBranch: targetBranch,
            reviewType: reviewType
        });
    }

    function handleReviewStarted() {
        console.log('handleReviewStarted called');
        
        // Reset chat review mode when starting a regular review
        isChatReviewMode = false;
        
        isReviewing = true;
        if (mainButton) mainButton.classList.add('disabled');
        disableBranchSelectors();
        setQuickActionsDisabled(true);
        
        previewSection?.classList.add('hidden');
        statusSection?.classList.add('hidden');
        resultsSection?.classList.remove('hidden');
        reviewStatus?.classList.remove('hidden');
        
        // Show branch comparison section for regular reviews
        const branchComparisonSection = document.getElementById('branchComparisonSection');
        branchComparisonSection?.classList.remove('hidden');
        
        // Ensure the results section is expanded when starting a review
        expandSection('resultsSection');
        
        if (reviewStatusText) reviewStatusText.textContent = 'Starting code review...';
        if (progressHideTimeout) {
            window.clearTimeout(progressHideTimeout);
            progressHideTimeout = null;
        }
        progressBar?.classList.remove('hidden');
        setProgress(0.08);
        
        // Clear previous results
        currentResults = [];
        currentSummary = null;
        if (reviewResults) {
            reviewResults.innerHTML = '';
            console.log('Cleared previous results');
        }
        if (reviewSummary) {
            reviewSummary.innerHTML = '';
            reviewSummary.classList.add('hidden');
        }
    }

    function handleChatReviewDisplaying() {
        console.log('handleChatReviewDisplaying called - results from chat');
        
        // Set flag to indicate we're in chat review mode
        isChatReviewMode = true;
        
        // Make sure we show the results section and hide other sections
        previewSection?.classList.add('hidden');
        statusSection?.classList.add('hidden');
        resultsSection?.classList.remove('hidden');
        
        // Hide the branch comparison section since it's not relevant for chat reviews
        const branchComparisonSection = document.getElementById('branchComparisonSection');
        branchComparisonSection?.classList.add('hidden');
        
        // Hide the review status spinner since this is from chat
        reviewStatus?.classList.add('hidden');
        progressBar?.classList.add('hidden');
        lastProgressRatio = 0;
        if (progressHideTimeout) {
            window.clearTimeout(progressHideTimeout);
            progressHideTimeout = null;
        }
        
        // Ensure the results section is expanded when showing chat results
        expandSection('resultsSection');
        
        console.log('UI prepared for chat review results - irrelevant sections hidden, chat mode enabled');
    }

    function handleReviewProgress(message) {
        if (reviewStatusText) reviewStatusText.textContent = message;
        updateProgressFromMessage(message);
    }

    function handleFileReviewCompleted(fileResult) {
        if (!fileResult) return;
        
        // Add to current results
        currentResults.push(fileResult);
        
        // Update status
        if (reviewStatusText) {
            reviewStatusText.textContent = `Reviewed ${currentResults.length} file(s)...`;
        }
        
        // Append just this file result to UI
        updateResultsUI([fileResult], null, false, true); // append mode
        setProgress(Math.max(lastProgressRatio, 0.12));
    }

    function handleReviewCompleted(results, errors, summary) {
        console.log('handleReviewCompleted called with:', {
            resultsCount: results?.length,
            errorsCount: errors?.length,
            summary,
        });
        
        isReviewing = false;
        if (mainButton) mainButton.classList.remove('disabled');
        enableBranchSelectors();
        setQuickActionsDisabled(false);
        
        // Hide spinner
        reviewStatus?.classList.add('hidden');
        
        // Ensure results section is visible
        resultsSection?.classList.remove('hidden');
        
        // If not in chat review mode, show branch comparison section
        if (!isChatReviewMode) {
            const branchComparisonSection = document.getElementById('branchComparisonSection');
            branchComparisonSection?.classList.remove('hidden');
        }
        
        // Show final results
        if (results && results.length > 0) {
            currentResults = results;
            console.log('Updating UI with results:', currentResults);
        } else {
            console.log('No results to display');
            currentResults = [];
        }
        currentSummary = summary || null;
        renderReviewSummary(currentSummary);

        updateResultsUI(currentResults, errors, true);
        setProgress(1);
        if (progressHideTimeout) {
            window.clearTimeout(progressHideTimeout);
        }
        progressHideTimeout = window.setTimeout(() => {
            progressBar?.classList.add('hidden');
            progressHideTimeout = null;
        }, 320);
    }

    function handleReviewError(message) {
        isReviewing = false;
        if (mainButton) mainButton.classList.remove('disabled');
        enableBranchSelectors();
        setQuickActionsDisabled(false);
        currentSummary = null;
        
        reviewStatus?.classList.add('hidden');
        progressBar?.classList.add('hidden');
        lastProgressRatio = 0;
        if (progressHideTimeout) {
            window.clearTimeout(progressHideTimeout);
            progressHideTimeout = null;
        }
        if (reviewSummary) {
            reviewSummary.innerHTML = '';
            reviewSummary.classList.add('hidden');
        }
        
        if (reviewResults) {
            reviewResults.innerHTML = `<div class="error-message">Error: ${message}</div>`;
        }
    }

    function renderReviewSummary(summary) {
        if (!reviewSummary) {
            return;
        }

        if (!summary) {
            reviewSummary.innerHTML = '';
            reviewSummary.classList.add('hidden');
            return;
        }

        const severityOrder = [5, 4, 3, 2, 1];
        const severityBadges = severityOrder
            .map(level => {
                const count = summary.severityCounts?.[level] || 0;
                return `<span class="severity-chip severity-${level}">S${level}: ${count}</span>`;
            })
            .join('');
        const modelUsed = escapeHtml(summary.modelUsed || 'unknown');
        const resourcesUsed = renderContextList(summary.resourcesUsed);
        const toolsUsed = renderContextList(summary.toolsUsed);

        reviewSummary.innerHTML = `
            <div class="summary-header">
                <div class="summary-title">Review Summary</div>
                <div class="summary-mode">${escapeHtml(summary.reviewMode || 'general')}</div>
            </div>
            <div class="summary-grid">
                <div class="summary-item"><span>Findings</span><strong>${summary.findingsTotal || 0}</strong></div>
                <div class="summary-item"><span>New</span><strong>${summary.findingsNew || 0}</strong></div>
                <div class="summary-item"><span>Carried</span><strong>${summary.findingsCarried || 0}</strong></div>
                <div class="summary-item"><span>Resolved</span><strong>${summary.findingsResolved || 0}</strong></div>
                <div class="summary-item"><span>Files reviewed</span><strong>${summary.reviewedFiles || 0}/${summary.totalFiles || 0}</strong></div>
                <div class="summary-item"><span>Skipped</span><strong>${summary.skippedUnchangedFiles || 0}</strong></div>
            </div>
            <div class="summary-meta">
                <span class="summary-pill">${summary.incrementalEnabled ? 'Incremental ON' : 'Incremental OFF'}</span>
                <span class="summary-pill">Open: ${summary.findingsOpen || 0}</span>
                <span class="summary-pill">Triaged: ${summary.findingsTriaged || 0}</span>
            </div>
            <div class="severity-strip">${severityBadges}</div>
            <div class="summary-context">
                <div><strong>Model:</strong> <code>${modelUsed}</code></div>
                <div><strong>Resources:</strong> ${resourcesUsed}</div>
                <div><strong>Tools:</strong> ${toolsUsed}</div>
            </div>
        `;
        reviewSummary.classList.remove('hidden');
        pulseSummaryCard();
    }

    function renderContextList(values) {
        if (!Array.isArray(values) || values.length === 0) {
            return 'none';
        }
        return values.map(value => `<code>${escapeHtml(String(value))}</code>`).join(', ');
    }

    function updateResultsUI(results, errors = null, isComplete = false, append = false) {
        void errors;
        if (!results || results.length === 0) {
            if (isComplete && reviewResults) {
                reviewResults.innerHTML = `
                    <div class="empty-state">
                        ✅ No issues found in the code review!
                    </div>
                `;
            }
            return;
        }

        let html = '';
        
        // Calculate file index offset for append mode
        const fileIndexOffset = append ? (reviewResults?.children.length || 0) : 0;
        
        results.forEach((file, fileIndex) => {
            const actualFileIndex = fileIndexOffset + fileIndex;
            const fileName = getFileName(file.target);
            
            html += `
                <div class="result-file">
                    <div class="result-file-header" data-file-index="${actualFileIndex}">
                        <div class="result-file-title">
                            ${getFileIcon()} ${fileName}
                        </div>
                        <svg class="result-file-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                            <path d="M6 9l6 6l6 -6" />
                        </svg>
                    </div>
                    <div class="result-comments" id="comments-${actualFileIndex}">
            `;
            
            file.comments.forEach(comment => {
                console.log('Processing comment:', comment);
                console.log('Has proposedAdjustment:', !!comment.proposedAdjustment);
                if (comment.proposedAdjustment) {
                    console.log('Proposed adjustment:', comment.proposedAdjustment);
                }
                const findingId = comment.findingId || '';
                const triageStatus = comment.triageStatus || 'open';
                
                html += `
                    <div class="result-comment severity-${comment.severity}" data-file-path="${escapeHtml(file.target)}" data-line="${comment.line}" data-comment="${escapeHtml(comment.comment)}" data-finding-id="${escapeHtml(findingId)}" data-triage-status="${escapeHtml(triageStatus)}">
                        <div class="comment-line">Line ${comment.line}</div>
                        <div class="comment-text">${parseMarkdown(comment.comment)}</div>
                        ${generateTriageControls(comment, currentSummary?.scopeKey)}
                        ${comment.proposedAdjustment ? generateProposedAdjustmentHTML(comment.proposedAdjustment) : ''}
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        });

        // Error handling temporarily disabled to focus on progressive updates
        // if (errors && Array.isArray(errors) && errors.length > 0 && isComplete) {
        //     html += `
        //         <div class="error-message">
        //             <strong>Errors occurred during review:</strong><br>
        //             ${errors.map(error => escapeHtml(error.message || error.toString())).join('<br>')}
        //         </div>
        //     `;
        // }

        if (reviewResults) {
            if (append) {
                // Append to existing content
                reviewResults.insertAdjacentHTML('beforeend', html);
            } else {
                // Replace all content
                reviewResults.innerHTML = html;
            }
            
            // Re-attach event listeners (only for new elements if appending)
            if (append) {
                attachResultEventListeners();
            } else {
                attachResultEventListeners();
            }
            animateResultCards();
            applyTriagedVisibility();
        }
    }

    function attachResultEventListeners() {
        if (!reviewResults) return;
        
        // Add click event listeners for collapsible headers
        const fileHeaders = reviewResults.querySelectorAll('.result-file-header[data-file-index]');
        fileHeaders.forEach(header => {
            if (header.getAttribute('data-click-listener') === '1') {
                return;
            }
            header.setAttribute('data-click-listener', '1');
            header.addEventListener('click', () => {
                const fileIndex = header.getAttribute('data-file-index');
                const commentsSection = document.getElementById(`comments-${fileIndex}`);
                const chevron = header.querySelector('.result-file-chevron');
                
                if (commentsSection && chevron) {
                    const isExpanded = commentsSection.classList.contains('expanded');
                    
                    if (isExpanded) {
                        commentsSection.classList.remove('expanded');
                        chevron.classList.remove('expanded');
                        header.classList.remove('expanded');
                    } else {
                        commentsSection.classList.add('expanded');
                        chevron.classList.add('expanded');
                        header.classList.add('expanded');
                    }
                }
            });
        });
        
        // Add click event listeners to comment elements
        const commentElements = reviewResults.querySelectorAll('.result-comment[data-file-path]');
        commentElements.forEach(element => {
            if (element.getAttribute('data-click-listener') === '1') {
                return;
            }
            element.setAttribute('data-click-listener', '1');
            element.addEventListener('click', () => {
                if (element.classList.contains('triaged-hidden')) {
                    return;
                }
                openResultComment(element);
            });
        });

        const triageButtons = reviewResults.querySelectorAll('.triage-button[data-finding-id]');
        triageButtons.forEach(button => {
            if (button.getAttribute('data-click-listener') === '1') {
                return;
            }
            button.setAttribute('data-click-listener', '1');
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const findingId = button.getAttribute('data-finding-id');
                const scopeKey = button.getAttribute('data-scope-key');
                const status = button.getAttribute('data-triage-status');

                const commentElement = button.closest('.result-comment[data-file-path]');
                if (commentElement && !commentElement.classList.contains('triaged-hidden')) {
                    openResultComment(commentElement);
                }

                if (findingId && scopeKey && status) {
                    vscode.postMessage({
                        type: 'setFindingTriageStatus',
                        findingId,
                        scopeKey,
                        status,
                    });
                }
            });
        });
    }

    function openResultComment(element) {
        const filePath = element.getAttribute('data-file-path');
        const lineAttr = element.getAttribute('data-line');
        const comment = element.getAttribute('data-comment');

        if (!filePath || !lineAttr || !comment) {
            return;
        }

        const line = parseInt(lineAttr, 10);
        if (Number.isNaN(line)) {
            return;
        }

        element.classList.remove('is-opening');
        if (!prefersReducedMotion) {
            void element.offsetWidth;
            element.classList.add('is-opening');
            window.setTimeout(() => {
                element.classList.remove('is-opening');
            }, 420);
        }

        vscode.postMessage({
            type: 'openFile',
            filePath: filePath,
            line: line,
            comment: comment
        });
    }

    function handleTriageStatusUpdated(findingId, status) {
        if (!reviewResults || !findingId || !status) {
            return;
        }

        const commentElements = reviewResults.querySelectorAll(`.result-comment[data-finding-id="${escapeSelector(findingId)}"]`);
        commentElements.forEach((element) => {
            element.setAttribute('data-triage-status', status);
            const buttons = element.querySelectorAll('.triage-button[data-triage-status]');
            buttons.forEach(button => {
                const buttonStatus = button.getAttribute('data-triage-status');
                button.classList.toggle('active', buttonStatus === status);
                if (buttonStatus === status) {
                    button.classList.remove('just-activated');
                    if (!prefersReducedMotion) {
                        void button.offsetWidth;
                        button.classList.add('just-activated');
                    }
                }
            });
        });
        applyTriagedVisibility();
    }

    function applyTriagedVisibility() {
        if (!reviewResults) {
            return;
        }

        const hideTriaged = !!hideTriagedToggle?.checked;
        const commentElements = reviewResults.querySelectorAll('.result-comment[data-triage-status]');
        commentElements.forEach(element => {
            const status = element.getAttribute('data-triage-status') || 'open';
            const shouldHide = hideTriaged && status !== 'open';
            element.classList.toggle('triaged-hidden', shouldHide);
        });
    }

    function showResults(results, errors) {
        updateResultsUI(results, errors, true);
    }

    function showError(message) {
        statusSection?.classList.remove('hidden');
        if (statusMessage) statusMessage.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
        progressBar?.classList.add('hidden');
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function generateProposedAdjustmentHTML(proposedAdjustment) {
        return `
            <div class="proposed-adjustment">
                <div class="proposed-adjustment-header">
                    <div class="proposed-adjustment-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="adjustment-icon">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                        Proposed Adjustment
                    </div>
                </div>
                <div class="proposed-adjustment-description">${escapeHtml(proposedAdjustment.description)}</div>
                <div class="code-diff">
                    <div class="diff-section">
                        <div class="diff-header diff-removed">- Original</div>
                        <pre class="diff-code diff-code-removed"><code>${escapeHtml(proposedAdjustment.originalCode)}</code></pre>
                    </div>
                    <div class="diff-section">
                        <div class="diff-header diff-added">+ Proposed</div>
                        <pre class="diff-code diff-code-added"><code>${escapeHtml(proposedAdjustment.adjustedCode)}</code></pre>
                    </div>
                </div>
            </div>
        `;
    }

    function generateTriageControls(comment, scopeKey) {
        if (!comment?.findingId) {
            return '';
        }

        const current = comment.triageStatus || 'open';
        const scope = scopeKey || '';
        const unavailableTitle = scope
            ? ''
            : 'title="Triage status update unavailable for this result set."';
        const findingId = escapeHtml(comment.findingId);
        const scopeValue = escapeHtml(scope);

        return `
            <div class="triage-controls" data-finding-id="${findingId}">
                <button class="triage-button ${current === 'open' ? 'active' : ''}" data-finding-id="${findingId}" data-scope-key="${scopeValue}" data-triage-status="open" ${unavailableTitle}>Open</button>
                <button class="triage-button ${current === 'accepted' ? 'active' : ''}" data-finding-id="${findingId}" data-scope-key="${scopeValue}" data-triage-status="accepted" ${unavailableTitle}>Accepted</button>
                <button class="triage-button ${current === 'false_positive' ? 'active' : ''}" data-finding-id="${findingId}" data-scope-key="${scopeValue}" data-triage-status="false_positive" ${unavailableTitle}>Not an issue</button>
            </div>
        `;
    }

    function escapeSelector(text) {
        if (!text) {
            return '';
        }
        return text.replace(/["\\]/g, '\\$&');
    }

    // Simple markdown parser for comment text
    function parseMarkdown(text) {
        if (!text) return '';
        
        // Escape HTML first, but we'll selectively allow markdown
        let result = escapeHtml(text);
        
        // Code blocks first (to avoid conflicts with inline code)
        result = result.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        
        // Inline code: `code`
        result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Bold: **text** or __text__ (but not if inside code)
        result = result.replace(/(?!<code[^>]*>.*)\*\*((?:(?!\*\*).)*)\*\*(?![^<]*<\/code>)/g, '<strong>$1</strong>');
        result = result.replace(/(?!<code[^>]*>.*)\b__((?:(?!__).)*?)__\b(?![^<]*<\/code>)/g, '<strong>$1</strong>');
        
        // Italic: *text* or _text_ (but not if inside code, and not if it's part of bold)
        result = result.replace(/(?!<code[^>]*>.*)\*([^*\s][^*]*[^*\s]|\S)\*(?![^<]*<\/code>)/g, '<em>$1</em>');
        result = result.replace(/(?!<code[^>]*>.*)(?<!\w)_([^_\s][^_]*[^_\s]|\S)_(?!\w)(?![^<]*<\/code>)/g, '<em>$1</em>');
        
        // Links: [text](url)
        result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        
        // Headers: # Header, ## Header, etc.
        result = result.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        result = result.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        result = result.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        
        // Lists: - item or * item (but not if inside code blocks)
        result = result.replace(/^[\-\*]\s+(.+)$/gm, function(match, p1) {
            // Simple check to avoid processing inside code blocks
            return '<li>' + p1 + '</li>';
        });
        
        // Wrap consecutive list items in ul tags
        result = result.replace(/(<li>.*?<\/li>)(\s*<li>.*?<\/li>)*/g, function(match) {
            return '<ul>' + match + '</ul>';
        });
        
        // Line breaks: convert \n to <br> (but not inside pre/code blocks)
        result = result.replace(/\n(?![^<]*<\/(?:pre|code)>)/g, '<br>');
        
        return result;
    }

})();
