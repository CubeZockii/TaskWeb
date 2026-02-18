import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
    getFirestore,
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDoc,
    onSnapshot,
    serverTimestamp,
    deleteField,
    query,
    where,
    getDocs,
    setDoc,
    orderBy, // Added orderBy for sorting by createdAt
    limit // Added limit for finding the oldest
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM content loaded. Initializing app...");

    // --- Firebase Configuration ---
    let firebaseConfig = {};
    if (typeof __firebase_config !== 'undefined' && __firebase_config) {
        // Use environment variable for Firebase config if available (for Canvas)
        try {
            firebaseConfig = JSON.parse(__firebase_config);
            console.log("Using Firebase config from environment variables.");
        } catch (e) {
            console.error("Error parsing __firebase_config:", e);
            // Fallback to default if parsing fails
            firebaseConfig = {
                apiKey: "AIzaSyDNY51Jui8EOiCGQMdpLsn2kW4yTPYkk2w",
                authDomain: "taskflow-841c1.firebaseapp.com",
                projectId: "taskflow-841c1",
                storageBucket: "taskflow-841c1.firebasestorage.app",
                messagingSenderId: "109204779254",
                appId: "1:109204779254:web:ed340a07677a37fa8277cd7"
            };
            showCustomModal("Failed to load Firebase configuration. Please check the environment setup.", "Configuration Error", 'alert');
        }
    } else {
        // Fallback to default if environment variable is not defined (for local development)
        firebaseConfig = {
            apiKey: "AIzaSyDNY51Jui8EOiCGQMdpLsn2kW4yTPYkk2w",
            authDomain: "taskflow-841c1.firebaseapp.com",
            projectId: "taskflow-841c1",
            storageBucket: "taskflow-841c1.firebasestorage.app",
            messagingSenderId: "109204779254",
            appId: "1:109204779254:web:ed340a07677a37fa827cd7"
        };
        console.warn("Firebase config not found in environment variables. Using default placeholders.");
    }


    // --- Initialize Firebase ---
    console.log("Initializing Firebase app with projectId:", firebaseConfig.projectId);
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const auth = getAuth(app);
    console.log("Firebase initialized. DB and Auth instances created.");

    // --- DOM Elements ---
    const body = document.body;
    const dashboardViewBtn = document.getElementById('dashboardViewBtn');
    const kanbanViewBtn = document.getElementById('kanbanViewBtn');
    const pageTitle = document.getElementById('pageTitle');
    const menuToggleBtn = document.getElementById('menuToggleBtn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.overlay');

    // Modals
    const openModalBtn = document.getElementById('openModalBtn');
    openModalBtn.disabled = true; // Button initially disabled
    const taskModal = document.getElementById('taskModal');
    const boardModal = document.getElementById('boardModal'); // Initial board creation/join modal
    const shareModal = document.getElementById('shareModal');
    const modalTitle = document.getElementById('modalTitle');
    const saveTaskBtn = document.getElementById('saveTaskBtn');
    const taskLockedMessage = document.getElementById('taskLockedMessage'); // New element for locked message

    // Task Form Inputs
    const taskNameInput = document.getElementById('taskName');
    const taskDescriptionInput = document.getElementById('taskDescription');
    const priorityDropdownContainer = document.querySelector('.priority-dropdown-container');
    const taskPriorityDisplay = document.getElementById('priorityDropdownDisplay');
    const taskPriorityMenu = document.getElementById('priorityDropdownMenu');
    const selectedPriorityText = document.getElementById('selectedPriorityText');
    const taskDueDateInput = document.getElementById('taskDueDate');
    let taskPriorityValue = 'low';

    // Dashboard Elements
    const totalCountElement = document.getElementById('totalCount');
    const todoCountElement = document.getElementById('todoCount');
    const inProgressCountElement = document.getElementById('inProgressCount');
    const doneCountElement = document.getElementById('doneCount');
    const highPriorityCountElement = document.getElementById('highPriorityCount');
    const overdueCountElement = document.getElementById('overdueCount');
    const completionBar = document.getElementById('completionBar');
    const completionText = document.getElementById('completionText');
    const highPriorityBar = document.getElementById('highPriorityBar');
    const mediumPriorityBar = document.getElementById('mediumPriorityBar');
    const lowPriorityBar = document.getElementById('lowPriorityBar');

    // Kanban Columns
    const kanbanColumns = {
        todo: document.getElementById('column-todo').querySelector('.task-list-kanban'),
        inprogress: document.getElementById('column-inprogress').querySelector('.task-list-kanban'),
        done: document.getElementById('column-done').querySelector('.task-list-kanban')
    };

    // Board Management Elements (from initial boardModal)
    const createSoloBoardBtn = document.getElementById('createSoloBoardBtn');
    const createCollaborativeBoardBtn = document.getElementById('createCollaborativeBoardBtn');
    const joinBoardBtn = document.getElementById('joinBoardBtn');
    const joinBoardIdInput = document.getElementById('joinBoardId');
    const shareBoardBtn = document.getElementById('shareBoardBtn');
    const closeShareModalBtn = document.getElementById('closeShareModal');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const shareableLinkInput = document.getElementById('shareableLink');
    const shareableBoardIdInput = document.getElementById('shareableBoardId');
    const openBoardSelectionBtn = document.getElementById('openBoardSelectionBtn'); // Button to open board selection

    // New: Shortcut button for joining collaborative boards
    const joinCollaborativeBoardShortcutBtn = document.getElementById('joinCollaborativeBoardShortcutBtn');

    // NEW: Elements for the new Join Collaborative Board Modal
    const joinCollaborativeBoardModal = document.getElementById('joinCollaborativeBoardModal');
    const closeJoinCollaborativeBoardModalBtn = document.getElementById('closeJoinCollaborativeBoardModal');
    const joinCollaborativeBoardIdInput = document.getElementById('joinCollaborativeBoardIdInput');
    const joinCollaborativeBoardConfirmBtn = document.getElementById('joinCollaborativeBoardConfirmBtn');


    // User Info Display
    const userIdText = document.getElementById('userIdText');
    const boardIdText = document.getElementById('boardIdText');
    const activeUsersLabel = document.getElementById('activeUsersLabel'); // New
    const activeUsersCountElement = document.getElementById('activeUsersCount'); // New

    // --- App State ---
    let tasks = [];
    let currentTaskToEditId = null;
    let userId = null;
    let boardId = null; // Currently active board ID
    let unsubscribeTasks = null; // For Firestore tasks listener
    let unsubscribePresence = null; // For Firestore presence listener
    let isOwnerBoard = false;
    let currentBoardCollaborative = false; // New flag: is the current board collaborative?
    let activeUsers = []; // Array of active user IDs
    let heartbeatInterval = null; // Interval for presence updates

    // Store user's solo board ID in localStorage (it's unique per user)
    let mySoloBoardId = localStorage.getItem('mySoloBoardId');
    // Store user's owned collaborative board IDs (fetched dynamically from Firestore)
    let myCollaborativeBoards = []; // Array of { id, name } for collaborative boards

    // --- Custom Modal for Notifications and Confirmations ---
    const customModalHtml = `
        <div id="customAlertConfirmModal" class="modal">
            <div class="modal-content">
                <span class="close-btn" id="customModalCloseBtn">&times;</span>
                <h2 id="customModalTitle"></h2>
                <p id="customModalMessage"></p>
                <div class="modal-actions" id="customModalActions">
                    <button id="customModalConfirmBtn" class="primary-btn" style="display:none;">Confirm</button>
                    <button id="customModalCancelBtn" class="secondary-btn" style="display:none;">Cancel</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', customModalHtml);

    const customModal = document.getElementById('customAlertConfirmModal');
    const customModalTitle = document.getElementById('customModalTitle');
    const customModalMessage = document.getElementById('customModalMessage');
    const customModalActions = document.getElementById('customModalActions');
    const customModalConfirmBtn = document.getElementById('customModalConfirmBtn');
    const customModalCancelBtn = document.getElementById('customModalCancelBtn');
    const customModalCloseBtn = document.getElementById('customModalCloseBtn');

    function showCustomModal(message, title = "Note", type = 'alert', onConfirm = null) {
        customModalTitle.textContent = title;
        customModalMessage.textContent = message;
        customModal.style.display = 'flex';
        body.classList.add('no-scroll');

        customModalConfirmBtn.style.display = 'none';
        customModalCancelBtn.style.display = 'none';

        if (type === 'confirm') {
            customModalConfirmBtn.style.display = 'inline-block';
            customModalCancelBtn.style.display = 'inline-block';
            customModalConfirmBtn.textContent = 'Confirm'; // Reset text for confirm

            customModalConfirmBtn.onclick = () => {
                customModal.style.display = 'none';
                body.classList.remove('no-scroll');
                if (onConfirm) onConfirm(true);
            };
            customModalCancelBtn.onclick = () => {
                customModal.style.display = 'none';
                body.classList.remove('no-scroll');
                if (onConfirm) onConfirm(false);
            };
        } else { // 'alert' type
            customModalConfirmBtn.style.display = 'inline-block'; // Show 'Ok' button
            customModalConfirmBtn.textContent = 'OK';
            customModalConfirmBtn.onclick = () => {
                customModal.style.display = 'none';
                body.classList.remove('no-scroll');
            };
        }
        customModalCloseBtn.onclick = () => {
            customModal.style.display = 'none';
            body.classList.remove('no-scroll');
            if (type === 'confirm' && onConfirm) onConfirm(false); // If closed without choice for confirm
        };
    }

    // --- New Modal for Managing Boards (Solo & Collaborative) ---
    const manageBoardsModalHtml = `
        <div id="manageBoardsModal" class="modal">
            <div class="modal-content bg-white p-6 rounded-xl shadow-lg w-full max-w-lg mx-auto transform transition-all duration-300 ease-in-out scale-95 opacity-0" style="opacity:1; scale:1;">
                <span class="close-btn text-gray-500 hover:text-gray-800 text-3xl font-bold absolute top-3 right-5 cursor-pointer" id="closeManageBoardsModal">&times;</span>
                <h2 class="text-2xl font-semibold text-gray-800 mb-6 text-center">Manage Your Boards</h2>

                <div class="mb-6 p-4 border border-blue-200 bg-blue-50 rounded-lg">
                    <h3 class="text-xl font-medium text-blue-700 mb-3 flex items-center">
                        Solo Board
                    </h3>
                    <div id="soloBoardSection" class="text-center">
                        <!-- Solo board info or create button will go here -->
                    </div>
                </div>

                <div class="mb-6 p-4 border border-green-200 bg-green-50 rounded-lg">
                    <h3 class="text-xl font-medium text-green-700 mb-3 flex items-center">
                        Collaborative Boards
                    </h3>
                    <div id="collaborativeBoardList" class="board-list-container space-y-2 mb-3">
                        <!-- Collaborative boards will be listed here -->
                    </div>
                    <button style="margin-top: 30px;" id="createNewCollaborativeBoardBtn" class="primary-btn w-full py-2 px-4 rounded-md shadow-sm transition duration-150 ease-in-out hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50">Create New Collaborative Board</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', manageBoardsModalHtml);

    const manageBoardsModal = document.getElementById('manageBoardsModal');
    const closeManageBoardsModalBtn = document.getElementById('closeManageBoardsModal');
    const soloBoardSection = document.getElementById('soloBoardSection');
    const collaborativeBoardList = document.getElementById('collaborativeBoardList');
    const createNewCollaborativeBoardBtn = document.getElementById('createNewCollaborativeBoardBtn');


    // Function to update UI based on board activity and type
    function updateUIForBoardState(isBoardActive, isBoardCollaborative = false) {
        console.log("Updating UI for board state. Is active:", isBoardActive, "Is collaborative:", isBoardCollaborative);
        if (isBoardActive) {
            openModalBtn.disabled = false;
            boardModal.style.display = 'none';
            manageBoardsModal.style.display = 'none'; // Ensure this is hidden
            joinCollaborativeBoardModal.style.display = 'none'; // Ensure new join modal is hidden
            // Show/hide share button based on board type
            shareBoardBtn.style.display = isBoardCollaborative ? 'inline-block' : 'none';
            activeUsersLabel.style.display = isBoardCollaborative ? 'block' : 'none';
            activeUsersCountElement.style.display = isBoardCollaborative ? 'block' : 'none';

            // Show/hide the "Join Collaborative Board" shortcut button ONLY if it's a solo board
            joinCollaborativeBoardShortcutBtn.style.display = isBoardCollaborative ? 'none' : 'inline-block';

        } else {
            openModalBtn.disabled = true;
            boardModal.style.display = 'flex'; // This ensures the modal is shown when no board is active
            shareBoardBtn.style.display = 'none';
            activeUsersLabel.style.display = 'none';
            activeUsersCountElement.style.display = 'none';
            manageBoardsModal.style.display = 'none'; // Ensure this is hidden
            joinCollaborativeBoardModal.style.display = 'none'; // Ensure new join modal is hidden
            joinCollaborativeBoardShortcutBtn.style.display = 'none'; // Always hide if no board is active
        }
    }


    // --- Authentication ---
    console.log("Setting up onAuthStateChanged listener.");
    onAuthStateChanged(auth, async (user) => {
        console.log("onAuthStateChanged triggered. User object:", user);
        if (user) {
            userId = user.uid;
            userIdText.textContent = userId;
            console.log("User ID set:", userId);
            initApp();
        } else {
            console.log("No user signed in. Attempting custom token sign-in or anonymous.");
            try {
                // Use __initial_auth_token if available (Canvas environment)
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                    console.log("Signed in with custom token.");
                } else {
                    // Fallback to anonymous sign-in if no custom token (local development)
                    await signInAnonymously(auth);
                    console.log("Signed in anonymously.");
                }
            } catch (error) {
                console.error("Error during authentication:", error);
                showCustomModal("There was an error during login. Please try again later.", "Login Error", 'alert');
            }
        }
    });

    // --- App Initialization ---
    async function initApp() {
        console.log("initApp called. User ID:", userId);
        const urlParams = new URLSearchParams(window.location.search);
        const urlBoardId = urlParams.get('board');

        let targetBoardId = null;
        let isFromURL = false;

        if (urlBoardId) {
            targetBoardId = urlBoardId;
            isFromURL = true;
            console.log("Board ID from URL:", targetBoardId);
        }

        // Fetch user's solo board and collaborative boards
        await fetchUserBoards();

        if (targetBoardId) {
            // Attempt to load the board specified in the URL
            await loadBoard(targetBoardId, isFromURL);
        } else if (mySoloBoardId) {
            // If no URL board, try to load the user's solo board if it exists
            await loadBoard(mySoloBoardId);
        } else if (myCollaborativeBoards.length > 0) {
            // If no solo board, check for collaborative boards
            if (myCollaborativeBoards.length === 1) {
                // Automatically load if only one collaborative board
                await loadBoard(myCollaborativeBoards[0].id);
            } else {
                // If multiple collaborative boards, open the selection modal
                openManageBoardsModal();
            }
        } else {
            // No boards found, show the initial board creation/join modal
            console.log("No Board ID in URL or LocalStorage, and no owned boards found. Showing board creation modal.");
            updateUIForBoardState(false);
        }
    }

    // New function to fetch user's solo and collaborative boards
    async function fetchUserBoards() {
        if (!userId) {
            console.warn("fetchUserBoards called without userId.");
            return;
        }
        try {
            const ownedBoardsQuery = query(collection(db, 'boards'), where('owner', '==', userId));
            const querySnapshot = await getDocs(ownedBoardsQuery);

            mySoloBoardId = null; // Reset solo board ID
            myCollaborativeBoards = []; // Reset collaborative boards

            querySnapshot.forEach(doc => {
                const boardData = doc.data();
                if (boardData.isCollaborative) {
                    myCollaborativeBoards.push({ id: doc.id, name: boardData.name || `Board ${doc.id.substring(0, 4)}`, createdAt: boardData.createdAt });
                } else {
                    // Assuming only one solo board is ever created per user
                    mySoloBoardId = doc.id;
                }
            });
            // Sort collaborative boards by createdAt to easily find the oldest
            myCollaborativeBoards.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());

            localStorage.setItem('mySoloBoardId', mySoloBoardId || ''); // Update local storage for solo board
            console.log("Fetched user boards. Solo:", mySoloBoardId, "Collaborative:", myCollaborativeBoards.length);
        } catch (error) {
            console.error("Error fetching user boards:", error);
            showCustomModal("Error fetching your boards. Please try again.", "Error", 'alert');
        }
    }

    // New function to load a board
    async function loadBoard(idToLoad, isFromURL = false) {
        if (!idToLoad) {
            console.warn("loadBoard called with empty ID.");
            updateUIForBoardState(false);
            return false; // Indicate failure
        }

        try {
            const boardDocRef = doc(db, 'boards', idToLoad);
            const boardDoc = await getDoc(boardDocRef);

            if (boardDoc.exists()) {
                const boardData = boardDoc.data();
                if (boardData.owner === userId || (isFromURL && boardData.isCollaborative)) {
                    boardId = idToLoad;
                    boardIdText.textContent = boardId;
                    isOwnerBoard = (boardData.owner === userId);
                    currentBoardCollaborative = boardData.isCollaborative || false;

                    window.history.pushState({}, '', `?board=${boardId}`);
                    updateUIForBoardState(true, currentBoardCollaborative);
                    listenForTasks();
                    console.log("Successfully loaded board:", boardId, "Is owner:", isOwnerBoard, "Is collaborative:", currentBoardCollaborative);

                    // Update localStorage for solo board if applicable
                    if (!currentBoardCollaborative) {
                        localStorage.setItem('mySoloBoardId', boardId);
                    } else {
                        // If switching from solo to collaborative, clear solo board from local storage
                        // (or if explicitly loading a collaborative board, don't set solo board)
                        // No action needed for collaborative boards here, as they are fetched dynamically.
                    }

                    // Start presence tracking if collaborative
                    if (currentBoardCollaborative) {
                        setupUserPresence();
                    } else {
                        removeUserPresence();
                        activeUsersCountElement.textContent = '0';
                    }

                    return true; // Board loaded successfully
                } else if (!boardData.isCollaborative && isFromURL && boardData.owner !== userId) {
                    // Trying to join a solo board via URL that isn't owned by current user
                    console.warn("Attempted to join a solo board not owned by user via URL. Access denied.");
                    showCustomModal("This is a solo board and cannot be shared. Please create your own or join a collaborative board.", "Access Denied", 'alert');
                    window.history.pushState({}, '', window.location.pathname);
                    updateUIForBoardState(false);
                    return false;
                } else if (boardData.isCollaborative && !isFromURL && boardData.owner !== userId) {
                    // Trying to load a collaborative board not owned by user, not from URL (e.g., old localstorage reference)
                    console.warn("Attempted to load a collaborative board not owned by user without URL. Access denied.");
                    showCustomModal("You do not have access to this board.", "Access Denied", 'alert');
                    window.history.pushState({}, '', window.location.pathname);
                    updateUIForBoardState(false);
                    return false;
                }
            } else {
                // Board from URL/LocalStorage does not exist (e.g., deleted)
                console.warn("Board from URL/LocalStorage does not exist:", idToLoad);
                showCustomModal("Board not found or no longer exists. Please check the ID or create a new board.", "Board Not Found", 'alert');
                // Clear any invalid local storage reference for solo board
                if (localStorage.getItem('mySoloBoardId') === idToLoad) {
                    localStorage.removeItem('mySoloBoardId');
                    mySoloBoardId = null; // Update in-memory state
                }
                window.history.pushState({}, '', window.location.pathname);
                updateUIForBoardState(false);
                return false;
            }
        } catch (error) {
            console.error("Error loading board:", error);
            showCustomModal("Error loading board. Please check your connection.", "Error", 'alert');
            // Clear any invalid local storage reference for solo board
            if (localStorage.getItem('mySoloBoardId') === idToLoad) {
                localStorage.removeItem('mySoloBoardId');
                mySoloBoardId = null; // Update in-memory state
            }
            window.history.pushState({}, '', window.location.pathname);
            updateUIForBoardState(false);
            return false;
        }
    }


    // --- Board Management ---
    async function createNewBoard(isCollaborative) {
        console.log(`Create ${isCollaborative ? 'Collaborative' : 'Solo'} Board button clicked.`);
        if (!userId) {
            showCustomModal("User is not logged in. Please wait until the login process is complete.", "Registration pending", 'alert');
            console.warn("Attempted to create board before user was authenticated.");
            return;
        }

        try {
            if (!isCollaborative) { // Creating a Solo Board
                if (mySoloBoardId) {
                    showCustomModal(
                        `You already have a solo board (ID: ${mySoloBoardId}). Would you like to load it?`,
                        "Solo Board Exists",
                        'confirm',
                        async (confirmed) => {
                            if (confirmed) {
                                const loaded = await loadBoard(mySoloBoardId);
                                if (loaded) toggleSidebar(true);
                            } else {
                                console.log("User chose not to load existing solo board.");
                            }
                        }
                    );
                    return; // Exit as user made a choice or cancelled
                } else {
                    // Create a new solo board
                    const newBoardRef = doc(collection(db, 'boards'));
                    const newBoardId = newBoardRef.id;
                    await setDoc(newBoardRef, {
                        createdAt: serverTimestamp(),
                        owner: userId,
                        isCollaborative: false,
                        name: "My Solo Board" // Default name for solo board
                    });
                    mySoloBoardId = newBoardId;
                    localStorage.setItem('mySoloBoardId', newBoardId); // Persist solo board ID
                    showCustomModal(`New solo board created! ID: ${newBoardId}`, "Board Created", 'alert');
                    const loaded = await loadBoard(newBoardId);
                    if (loaded) toggleSidebar(true);
                }
            } else { // Creating a Collaborative Board
                const newBoardName = prompt("Enter a name for your new collaborative board (optional):");
                const boardName = newBoardName ? newBoardName.trim() : `Collaborative Board ${new Date().toLocaleDateString()}`;

                const newBoardRef = doc(collection(db, 'boards'));
                const newBoardId = newBoardRef.id;
                await setDoc(newBoardRef, {
                    createdAt: serverTimestamp(),
                    owner: userId,
                    isCollaborative: true,
                    name: boardName
                });
                // After creation, re-fetch user boards to update the in-memory list
                await fetchUserBoards();
                showCustomModal(`New collaborative board created! ID: ${newBoardId}`, "Board Created", 'alert');
                const loaded = await loadBoard(newBoardId);
                if (loaded) toggleSidebar(true);
            }

        } catch (error) {
            console.error("Error creating board:", error);
            showCustomModal("Board could not be created. Please try again.", "Error", 'alert');
        }
    }

    createSoloBoardBtn.addEventListener('click', () => createNewBoard(false));
    createCollaborativeBoardBtn.addEventListener('click', () => createNewBoard(true));


    // This joinBoardBtn is for the original boardModal, which stays the same
    joinBoardBtn.addEventListener('click', async () => {
        console.log("Join Board button clicked (from original boardModal).");
        if (!userId) {
            showCustomModal("User is not logged in. Please wait until the login process is complete.", "Registration pending", 'alert');
            console.warn("Attempted to join board before user was authenticated.");
            return;
        }
        const inputBoardId = joinBoardIdInput.value.trim();
        if (!inputBoardId) {
            showCustomModal("Please enter a board ID.", "Input required", 'alert');
            return;
        }
        const loaded = await loadBoard(inputBoardId, true); // Treat as if from URL for access check
        if (loaded) {
            joinBoardIdInput.value = ''; // Clear input after attempt
            toggleSidebar(true);
        }
    });

    // --- Open Manage Boards Modal ---
    openBoardSelectionBtn.addEventListener('click', async () => {
        console.log("Open Manage Boards button clicked.");
        // Ensure initial boardModal and new join modal are hidden if open
        boardModal.style.display = 'none';
        joinCollaborativeBoardModal.style.display = 'none';

        // Fetch latest board data before opening the modal
        await fetchUserBoards();
        openManageBoardsModal();
    });

    // New: Event listener for the "Join Collaborative Board" shortcut button
    joinCollaborativeBoardShortcutBtn.addEventListener('click', () => {
        console.log("Join Collaborative Board shortcut button clicked.");
        openNewJoinCollaborativeBoardModal(); // Open the new specific join modal
        toggleSidebar(true); // Close sidebar after opening the modal
    });

    // NEW: Functions for the dedicated Join Collaborative Board Modal
    function openNewJoinCollaborativeBoardModal() {
        joinCollaborativeBoardIdInput.value = ''; // Clear input field
        joinCollaborativeBoardModal.style.display = 'flex';
        body.classList.add('no-scroll');
        joinCollaborativeBoardIdInput.focus(); // Focus the input for convenience
        console.log("New Join Collaborative Board modal opened.");
    }

    function closeNewJoinCollaborativeBoardModal() {
        joinCollaborativeBoardModal.style.display = 'none';
        body.classList.remove('no-scroll');
        console.log("New Join Collaborative Board modal closed.");
    }

    closeJoinCollaborativeBoardModalBtn.addEventListener('click', closeNewJoinCollaborativeBoardModal);

    joinCollaborativeBoardConfirmBtn.addEventListener('click', async () => {
        console.log("Join Board button clicked (from new joinCollaborativeBoardModal).");
        if (!userId) {
            showCustomModal("User is not logged in. Please wait until the login process is complete.", "Registration pending", 'alert');
            console.warn("Attempted to join board before user was authenticated.");
            return;
        }
        const inputBoardId = joinCollaborativeBoardIdInput.value.trim();
        if (!inputBoardId) {
            showCustomModal("Please enter a board ID.", "Input required", 'alert');
            return;
        }
        const loaded = await loadBoard(inputBoardId, true); // Treat as if from URL for access check
        if (loaded) {
            closeNewJoinCollaborativeBoardModal(); // Close the new modal on successful load
        }
    });


    // Function to open and populate the Manage Boards Modal
    function openManageBoardsModal() {
        soloBoardSection.innerHTML = ''; // Clear existing content
        collaborativeBoardList.innerHTML = ''; // Clear existing content

        // Populate Solo Board Section
        if (mySoloBoardId) {
            soloBoardSection.innerHTML = `
                <p style="text-align: left" class="mb-2 text-gray-700">Your current solo board: <span class="font-bold">${mySoloBoardId}</span></p>
                <button style="margin-bottom: 20px;" id="loadSoloBoardBtn" class="primary-btn w-full py-2 px-4 rounded-md shadow-sm transition duration-150 ease-in-out hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50">Load My Solo Board</button>
            `;
            document.getElementById('loadSoloBoardBtn').addEventListener('click', async () => {
                const loaded = await loadBoard(mySoloBoardId);
                if (loaded) {
                    manageBoardsModal.style.display = 'none';
                    body.classList.remove('no-scroll');
                }
            });
        } else {
            soloBoardSection.innerHTML = `
                <p class="mb-2 text-gray-700">You don't have a solo board yet.</p>
                <button style="margin-bottom: 20px;" id="createSoloBoardFromManageBtn" class="primary-btn w-full py-2 px-4 rounded-md shadow-sm transition duration-150 ease-in-out hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50">Create New Solo Board</button>
            `;
            document.getElementById('createSoloBoardFromManageBtn').addEventListener('click', async () => {
                await createNewBoard(false); // Call the general create function for solo
                manageBoardsModal.style.display = 'none';
                body.classList.remove('no-scroll');
            });
        }

        // Populate Collaborative Boards List
        if (myCollaborativeBoards.length === 0) {
            collaborativeBoardList.innerHTML = '<p class="text-gray-600">You don\'t have any collaborative boards yet.</p>';
        } else {
            myCollaborativeBoards.forEach(board => {
                const boardItem = document.createElement('div');
                boardItem.className = 'flex justify-between items-center p-3 bg-white border border-gray-200 rounded-md shadow-sm transition duration-150 ease-in-out hover:bg-gray-50';
                boardItem.innerHTML = `
                    <span class="font-medium text-gray-800">${board.name} <span class="text-sm text-gray-500">(ID: ${board.id.substring(0, 4)}...)</span></span>
                    <div class="flex space-x-2">
                        <button style="margin-top: 20px;" class="select-collaborative-board-item-btn secondary-btn px-4 py-2 rounded-md transition duration-150 ease-in-out hover:bg-gray-200" data-id="${board.id}">Select</button>
                        ${isOwnerBoard ? `
                            <button style="margin-top: 10px;" class="edit-collaborative-board-btn secondary-btn px-4 py-2 rounded-md transition duration-150 ease-in-out hover:bg-yellow-200" data-id="${board.id}" data-name="${board.name}">Edit</button>
                            <button style="margin-top: 10px; margin-bottom: 20px;" class="delete-collaborative-board-btn secondary-btn px-4 py-2 rounded-md transition duration-150 ease-in-out hover:bg-red-200" data-id="${board.id}">Delete</button>
                        ` : ''}
                    </div>
                `;
                collaborativeBoardList.appendChild(boardItem);
            });

            document.querySelectorAll('.select-collaborative-board-item-btn').forEach(button => {
                button.addEventListener('click', async (e) => {
                    const selectedBoardId = e.target.dataset.id;
                    const loaded = await loadBoard(selectedBoardId);
                    if (loaded) {
                        manageBoardsModal.style.display = 'none';
                        body.classList.remove('no-scroll');
                    }
                });
            });

            // Event listeners for editing and deleting collaborative boards
            document.querySelectorAll('.edit-collaborative-board-btn').forEach(button => {
                button.addEventListener('click', async (e) => {
                    const boardIdToEdit = e.target.dataset.id;
                    const currentName = e.target.dataset.name;
                    manageBoardsModal.style.display = 'none';
                    body.classList.remove('no-scroll');
                    await editCollaborativeBoard(boardIdToEdit, currentName);
                });
            });

            document.querySelectorAll('.delete-collaborative-board-btn').forEach(button => {
                button.addEventListener('click', async (e) => {
                    const boardIdToDelete = e.target.dataset.id;
                    manageBoardsModal.style.display = 'none';
                    body.classList.remove('no-scroll');
                    await deleteCollaborativeBoard(boardIdToDelete);
                });
            });
        }

        // Event listener for creating new collaborative board from this modal
        createNewCollaborativeBoardBtn.onclick = async () => {
            await createNewBoard(true);
            manageBoardsModal.style.display = 'none';
            body.classList.remove('no-scroll');
        };

        manageBoardsModal.style.display = 'flex';
        manageBoardsModal.querySelector('.modal-content').classList.remove('scale-95', 'opacity-0'); // Reset animation
        manageBoardsModal.querySelector('.modal-content').classList.add('scale-100', 'opacity-100');
        body.classList.add('no-scroll');
    }

    closeManageBoardsModalBtn.addEventListener('click', () => {
        manageBoardsModal.style.display = 'none';
        body.classList.remove('no-scroll');
        // If no board is active after closing, show the initial board modal (for create/join)
        if (!boardId) {
            updateUIForBoardState(false);
        }
    });

    // New: Edit Collaborative Board Function
    async function editCollaborativeBoard(boardIdToEdit, currentName) {
        showCustomModal(`Enter new name for board ID: ${boardIdToEdit}`, "Edit Board Name", 'confirm', async (confirmed) => {
            if (confirmed) {
                const newName = prompt(`Rename board "${currentName}" to:`, currentName);
                if (newName && newName.trim() !== '') {
                    try {
                        await updateDoc(doc(db, 'boards', boardIdToEdit), { name: newName.trim() });
                        showCustomModal("Board name updated successfully!", "Success", 'alert');
                        await fetchUserBoards(); // Re-fetch to update the list in the modal
                        openManageBoardsModal(); // Re-open to display updated list
                    } catch (error) {
                        console.error("Error updating board name:", error);
                        showCustomModal("Failed to update board name.", "Error", 'alert');
                    }
                } else if (newName !== null) { // User clicked OK but entered empty/whitespace
                    showCustomModal("Board name cannot be empty.", "Invalid Input", 'alert');
                }
            }
        });
    }

    // Helper function to find the oldest collaborative board
    async function findOldestCollaborativeBoard() {
        try {
            const q = query(
                collection(db, 'boards'),
                where('owner', '==', userId),
                where('isCollaborative', '==', true),
                orderBy('createdAt', 'asc'), // Order by creation time ascending
                limit(1) // Get only the first (oldest) one
            );
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const oldestBoard = querySnapshot.docs[0];
                return { id: oldestBoard.id, ...oldestBoard.data() };
            }
            return null;
        } catch (error) {
            console.error("Error finding oldest collaborative board:", error);
            return null;
        }
    }


    // New: Delete Collaborative Board Function
    async function deleteCollaborativeBoard(boardIdToDelete) {
        showCustomModal(`Are you sure you want to delete this collaborative board (ID: ${boardIdToDelete})? This action cannot be undone.`, "Confirm Delete Board", 'confirm', async (confirmed) => {
            if (confirmed) {
                try {
                    // Delete all tasks within the board's subcollection
                    const tasksQuery = query(collection(db, 'boards', boardIdToDelete, 'tasks'));
                    const taskSnapshot = await getDocs(tasksQuery);
                    const deletePromises = [];
                    taskSnapshot.forEach(taskDoc => {
                        deletePromises.push(deleteDoc(doc(db, 'boards', boardIdToDelete, 'tasks', taskDoc.id)));
                    });
                    await Promise.all(deletePromises);

                    // Delete the board document itself
                    await deleteDoc(doc(db, 'boards', boardIdToDelete));

                    // If the deleted board was the currently active one, clear current board state
                    if (boardId === boardIdToDelete) {
                        boardId = null;
                        boardIdText.textContent = 'None';
                        currentBoardCollaborative = false;
                        removeUserPresence(); // Ensure presence is cleaned up
                        if (unsubscribeTasks) {
                            unsubscribeTasks();
                            unsubscribeTasks = null;
                        }
                        window.history.pushState({}, '', window.location.pathname); // Clear URL param

                        // After deletion, re-evaluate which board to load or show modal
                        await fetchUserBoards(); // Re-fetch all user boards
                        if (myCollaborativeBoards.length > 0) {
                            // If other collaborative boards exist, load the oldest one
                            const oldestBoard = await findOldestCollaborativeBoard();
                            if (oldestBoard) {
                                await loadBoard(oldestBoard.id);
                                showCustomModal("Board deleted. You have been switched to your oldest collaborative board.", "Board Deleted", 'alert');
                            } else {
                                // This case should theoretically not be reached if myCollaborativeBoards.length > 0
                                // but as a fallback, show the board modal
                                updateUIForBoardState(false);
                                showCustomModal("Board deleted. No other collaborative boards found. Please create or join a new board.", "Board Deleted", 'alert');
                            }
                        } else {
                            // If no other collaborative boards, open the board creation/join modal
                            updateUIForBoardState(false);
                            showCustomModal("Board deleted. No other collaborative boards found. Please create or join a new board.", "Board Deleted", 'alert');
                        }
                    } else {
                        // If a non-active collaborative board was deleted, just update the list
                        await fetchUserBoards();
                        showCustomModal("Board deleted successfully!", "Success", 'alert');
                    }
                } catch (error) {
                    console.error("Error deleting board:", error);
                    showCustomModal("Failed to delete board. Please try again.", "Error", 'alert');
                }
            }
        });
    }

    // --- Real-time Data Synchronization with Firestore ---
    function listenForTasks() {
        console.log("Setting up Firestore listener for board:", boardId);
        if (unsubscribeTasks) {
            console.log("Unsubscribing from previous tasks listener.");
            unsubscribeTasks(); // Disconnect old listener if boards are switched
        }
        if (!boardId) {
            console.warn("listenForTasks called without a boardId. Skipping listener setup.");
            return;
        }

        const tasksCollectionRef = collection(db, 'boards', boardId, 'tasks');

        unsubscribeTasks = onSnapshot(tasksCollectionRef, (snapshot) => {
            console.log("Firestore task snapshot received. Number of tasks:", snapshot.docs.length);
            tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderTasks();
        }, (error) => {
            console.error("Error while listening to tasks:", error);
            showCustomModal("Error loading tasks. Please try again.", "Data Error", 'alert');
        });
    }

    // --- User Presence Tracking (for Collaborative Boards) ---
    async function setupUserPresence() {
        console.log("Setting up user presence for board:", boardId);
        if (unsubscribePresence) {
            unsubscribePresence(); // Clean up previous listener
        }
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval); // Clear old heartbeat
        }
        if (!boardId || !userId) {
            console.warn("Cannot set up user presence without boardId or userId.");
            return;
        }

        const userPresenceDocRef = doc(db, 'boardPresence', boardId, 'users', userId);

        // Set initial presence and update periodically (heartbeat)
        const updatePresence = async () => {
            try {
                await setDoc(userPresenceDocRef, {
                    userId: userId,
                    lastActive: serverTimestamp(),
                }, { merge: true }); // Use merge to avoid overwriting existing fields
            } catch (error) {
                console.error("Error updating user presence:", error);
            }
        };

        // Update presence immediately
        updatePresence();

        // Set up heartbeat interval
        heartbeatInterval = setInterval(updatePresence, 10000); // Update every 10 seconds

        // Listen for all users on this board
        const presenceCollectionRef = collection(db, 'boardPresence', boardId, 'users');
        unsubscribePresence = onSnapshot(presenceCollectionRef, (snapshot) => {
            const now = Date.now();
            // Filter out users who haven't updated their presence in the last 15 seconds
            activeUsers = snapshot.docs.filter(doc => {
                const data = doc.data();
                if (data.lastActive && data.lastActive.toMillis) { // Check if it's a Firestore Timestamp
                    return (now - data.lastActive.toMillis()) < 15000; // 15 seconds grace period
                }
                return false; // Invalid timestamp, filter out
            }).map(doc => doc.data().userId);
            activeUsersCountElement.textContent = activeUsers.length;
            console.log("Active users:", activeUsers.length);
            renderTasks(); // Re-render tasks to reflect any new locks
        }, (error) => {
            console.error("Error listening to user presence:", error);
        });

        // Remove user presence when they close the tab/browser
        window.addEventListener('beforeunload', async () => {
            if (userPresenceDocRef) {
                try {
                    await deleteDoc(userPresenceDocRef);
                    console.log("User presence removed on unload.");
                } catch (e) {
                    console.warn("Failed to remove user presence on unload:", e);
                }
            }
        });
    }

    // Function to remove user presence (e.g., when switching to a solo board)
    async function removeUserPresence() {
        if (unsubscribePresence) {
            console.log("Unsubscribing from presence listener.");
            unsubscribePresence();
            unsubscribePresence = null;
        }
        if (heartbeatInterval) {
            console.log("Clearing heartbeat interval.");
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        // Only attempt to delete if boardId and userId are set (i.e., we were actively tracking presence)
        if (boardId && userId) {
            try {
                const userPresenceDocRef = doc(db, 'boardPresence', boardId, 'users', userId);
                await deleteDoc(userPresenceDocRef);
                console.log("Current user presence removed from Firestore.");
            } catch (error) {
                console.warn("Error removing user presence:", error);
            }
        }
    }


    // --- UI Functions (Sidebar, Views, Modals) ---
    function toggleSidebar(forceClose = false) {
        // Check if the screen width is considered "small" (e.g., less than 1024px for mobile/tablet)
        const isSmallScreen = window.innerWidth <= 1024;

        if (isSmallScreen) {
            if (forceClose || sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
                body.classList.remove('no-scroll');
            } else {
                sidebar.classList.add('open');
                overlay.classList.add('active');
                body.classList.add('no-scroll');
            }
        } else {
            // For larger screens, sidebar should remain open and not be affected by toggleSidebar(true)
            // unless explicitly toggled (which doesn't happen with the current calls for board switch)
            // However, ensuring overlay and no-scroll are managed in case they were set by small screen interaction
            if (forceClose) { // If forceClose is true, it means we want to ensure it's closed (even if large screen logic usually keeps it open)
                sidebar.classList.remove('open'); // Ensure it's closed
                overlay.classList.remove('active');
                body.classList.remove('no-scroll');
            }
            // If it's a large screen and not forced close, leave it as is (likely open)
        }
    }

    menuToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidebar();
    });

    overlay.addEventListener('click', () => toggleSidebar(true));

    function switchView(viewId, title) {
        document.querySelectorAll('.view-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(viewId).classList.add('active');

        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(viewId + 'Btn').classList.add('active');

        pageTitle.textContent = title;
        toggleSidebar(true); // Close sidebar after switching views
    }

    dashboardViewBtn.addEventListener('click', () => switchView('dashboardView', 'Dashboard overview'));
    kanbanViewBtn.addEventListener('click', () => switchView('kanbanView', 'Kanban Board'));

    // --- Task Modal ---
    function clearModalInputs() {
        taskNameInput.value = '';
        taskDescriptionInput.value = '';
        taskPriorityValue = 'low';
        selectedPriorityText.textContent = 'Low';
        taskPriorityMenu.style.display = 'none';
        taskDueDateInput.value = '';
        taskLockedMessage.style.display = 'none'; // Hide lock message
        // Re-enable inputs
        taskNameInput.disabled = false;
        taskDescriptionInput.disabled = false;
        priorityDropdownContainer.style.pointerEvents = 'auto'; // Re-enable dropdown container
        taskDueDateInput.disabled = false;
        saveTaskBtn.disabled = false;
    }

    function openTaskModal() {
        if (!boardId) {
            showCustomModal("Please create a board or join one first!", "Board required", 'alert');
            return;
        }
        modalTitle.textContent = 'Create new task';
        saveTaskBtn.textContent = 'Save task';
        currentTaskToEditId = null; // Clear task for editing
        clearModalInputs();
        taskModal.style.display = 'flex';
        body.classList.add('no-scroll');
        console.log("Task modal opened for creation.");
    }

    async function closeTaskModal() {
        // If a task was being edited, unlock it
        if (currentTaskToEditId && currentBoardCollaborative) {
            try {
                // Check if the task is still locked by the current user before unlocking
                const taskRef = doc(db, 'boards', boardId, 'tasks', currentTaskToEditId);
                const taskDoc = await getDoc(taskRef);
                if (taskDoc.exists() && taskDoc.data().lockedBy === userId) {
                    await updateDoc(taskRef, { lockedBy: deleteField() });
                    console.log("Task unlocked:", currentTaskToEditId);
                } else {
                    console.log("Task was already unlocked or locked by another user. No action taken.");
                }
            } catch (error) {
                console.error("Error unlocking task:", error);
            }
        }
        currentTaskToEditId = null;
        taskModal.style.display = 'none';
        clearModalInputs();
        body.classList.remove('no-scroll');
        console.log("Task modal closed.");
    }

    openModalBtn.addEventListener('click', openTaskModal);
    taskModal.querySelector('.close-btn').addEventListener('click', closeTaskModal);

    window.addEventListener('click', async (event) => {
        if (event.target === taskModal) {
            await closeTaskModal(); // Ensure task is unlocked if modal is closed by clicking outside
        }
        if (event.target === shareModal) closeShareModal();
        if (event.target === customModal) {
            customModal.style.display = 'none';
            body.classList.remove('no-scroll');
        }
        if (event.target === manageBoardsModal) { // Handle clicking outside manage boards modal
            manageBoardsModal.style.display = 'none';
            body.classList.remove('no-scroll');
            if (!boardId) { // If no board is selected, re-open the initial board creation/join modal
                updateUIForBoardState(false);
            }
        }
        // NEW: Handle clicking outside the new join collaborative board modal
        if (event.target === joinCollaborativeBoardModal) {
            closeNewJoinCollaborativeBoardModal();
        }

        if (!priorityDropdownContainer.contains(event.target)) {
            taskPriorityMenu.style.display = 'none';
        }
    });

    taskPriorityDisplay.addEventListener('click', (event) => {
        event.stopPropagation();
        // Only allow dropdown if inputs are not disabled (i.e., task is not locked by others)
        if (!taskNameInput.disabled) {
            taskPriorityMenu.style.display = taskPriorityMenu.style.display === 'block' ? 'none' : 'block';
        }
    });

    document.querySelectorAll('.priority-option').forEach(option => {
        option.addEventListener('click', () => {
            taskPriorityValue = option.dataset.value;
            selectedPriorityText.textContent = option.textContent;
            taskPriorityMenu.style.display = 'none';
        });
    });

    // --- CRUD Operations ---
    saveTaskBtn.addEventListener('click', async () => {
        const name = taskNameInput.value.trim();
        if (name === '') {
            showCustomModal('Task name cannot be empty!', "Error", 'alert');
            return;
        }

        const taskData = {
            name: name,
            description: taskDescriptionInput.value.trim(),
            priority: taskPriorityValue,
            dueDate: taskDueDateInput.value,
            updatedAt: serverTimestamp()
        };

        try {
            if (currentTaskToEditId) {
                // Update existing task
                console.log("Updating task:", currentTaskToEditId, taskData);
                await updateDoc(doc(db, 'boards', boardId, 'tasks', currentTaskToEditId), taskData);
            } else {
                // Create new task
                taskData.status = 'todo';
                taskData.createdAt = serverTimestamp();
                taskData.owner = userId; // Owner is the creator of the task
                console.log("Adding new task:", taskData);
                await addDoc(collection(db, 'boards', boardId, 'tasks'), taskData);
            }
            await closeTaskModal(); // Ensure task is unlocked after saving
            showCustomModal("Task successfully saved!", "Success", 'alert');
        } catch (error) {
            console.error("Error saving task: ", error);
            showCustomModal("Task could not be saved. Please try again.", "Error", 'alert');
        }
    });

    async function openEditModal(event) {
        const taskId = event.target.closest('.card-action-btn').dataset.id;
        const task = tasks.find(t => t.id === taskId);

        if (task) {
            clearModalInputs(); // Clear first to reset UI state

            // Check if board is collaborative and if task is locked by someone else
            if (currentBoardCollaborative && task.lockedBy && task.lockedBy !== userId) {
                taskLockedMessage.textContent = `This task is currently being edited by another user (ID: ${task.lockedBy}).`;
                taskLockedMessage.style.display = 'block';
                // Disable all inputs and save button
                taskNameInput.disabled = true;
                taskDescriptionInput.disabled = true;
                priorityDropdownContainer.style.pointerEvents = 'none'; // Disable dropdown container
                taskDueDateInput.disabled = true;
                saveTaskBtn.disabled = true;
                modalTitle.textContent = 'View Task'; // Change title to indicate read-only view
                saveTaskBtn.textContent = 'Locked'; // Change button text
            } else {
                // If not locked by others, or if solo board, proceed with editing/locking
                currentTaskToEditId = taskId;
                modalTitle.textContent = 'Edit Task';
                saveTaskBtn.textContent = 'Save Changes';
                taskLockedMessage.style.display = 'none'; // Ensure hidden

                // Lock the task for current user if collaborative
                if (currentBoardCollaborative) {
                    try {
                        // Check if the task is already locked by *this* user (e.g., refreshing page)
                        // Or if it's explicitly not locked by anyone
                        if (!task.lockedBy || task.lockedBy === userId) {
                            await updateDoc(doc(db, 'boards', boardId, 'tasks', taskId), { lockedBy: userId });
                            console.log("Task locked by current user:", taskId);
                        } else {
                            // This case shouldn't be reached if the initial check worked, but as a safeguard:
                            showCustomModal("This task is currently being edited by another user and cannot be edited by you.", "Task Locked", 'alert');
                            return;
                        }
                    } catch (error) {
                        console.error("Error locking task:", error);
                        showCustomModal("Could not lock task for editing. Please try again.", "Error", 'alert');
                        return; // Prevent opening modal if lock fails
                    }
                }
            }

            taskNameInput.value = task.name;
            taskDescriptionInput.value = task.description;
            taskPriorityValue = task.priority;
            selectedPriorityText.textContent = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
            taskDueDateInput.value = task.dueDate || '';

            taskModal.style.display = 'flex';
            body.classList.add('no-scroll');
            console.log("Edit task modal opened for task ID:", taskId);
        }
    }

    async function deleteTask(event) {
        const taskId = event.target.closest('.card-action-btn').dataset.id;
        const task = tasks.find(t => t.id === taskId);

        if (currentBoardCollaborative && task.lockedBy && task.lockedBy !== userId) {
            showCustomModal("This task is currently locked by another user and cannot be deleted.", "Task Locked", 'alert');
            return;
        }

        console.log("Delete task button clicked for ID:", taskId);
        showCustomModal('Are you sure you want to delete this task?', "Delete Task", 'confirm', async (confirmed) => {
            if (confirmed) {
                try {
                    console.log("Confirmed delete for task ID:", taskId);
                    await deleteDoc(doc(db, 'boards', boardId, 'tasks', taskId));
                    showCustomModal("Task successfully deleted!", "Success", 'alert');
                } catch (error) {
                    console.error("Error deleting the task: ", error);
                    showCustomModal("Task could not be deleted. Please try again.", "Error", 'alert');
                }
            } else {
                console.log("Delete cancelled for task ID:", taskId);
            }
        });
    }

    // --- Rendering ---
    function renderTasks() {
        console.log("Rendering tasks. Total tasks:", tasks.length);
        // Clear columns before re-drawing
        Object.values(kanbanColumns).forEach(col => col.innerHTML = '');

        tasks.forEach(task => {
            const kanbanCard = document.createElement('div');
            let cardClasses = `kanban-card priority-${task.priority}`;
            // Add 'locked' class if the task is locked by another user
            const isTaskLockedByOther = currentBoardCollaborative && task.lockedBy && task.lockedBy !== userId;

            if (isTaskLockedByOther) {
                cardClasses += ' locked';
            }

            kanbanCard.className = cardClasses;
            kanbanCard.setAttribute('draggable', isTaskLockedByOther ? false : true); // Make not draggable if locked by others
            kanbanCard.setAttribute('data-id', task.id);

            let lockIconHtml = '';
            if (isTaskLockedByOther) {
                lockIconHtml = `<img src="lock.svg" alt="Locked" class="lock-icon">`;
            }

            // Format due date if it exists
            let dueDateHtml = '';
            if (task.dueDate) {
                const dateParts = task.dueDate.split('-'); // Assuming YYYY-MM-DD format
                const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0].substring(2,4)}`; // DD/MM/YY
                dueDateHtml = `<div class="due-date-display"><img src="calendar.svg" alt="Due Date" class="calendar-icon"> ${formattedDate}</div>`;
            }


            kanbanCard.innerHTML = `
                ${lockIconHtml}
                <h4>${task.name}</h4>
                <p>${task.description || ''}</p> <!-- Display full description without truncation -->
                <div class="card-footer">
                    ${dueDateHtml}
                    <div class="card-actions">
                        <button class="card-action-btn edit-btn" data-id="${task.id}" ${isTaskLockedByOther ? 'disabled' : ''}>
                            <img src="edit-3.svg" alt="Edit">
                        </button>
                        <button class="card-action-btn delete-btn" data-id="${task.id}" ${isTaskLockedByOther ? 'disabled' : ''}>
                            <img src="trash-2.svg" alt="Delete">
                        </button>
                    </div>
                </div>
            `;

            kanbanCard.addEventListener('dragstart', dragStart);
            kanbanCard.addEventListener('dragend', dragEnd);

            if (kanbanColumns[task.status]) {
                kanbanColumns[task.status].appendChild(kanbanCard);
            }
        });

        // Add event listeners to new buttons (ensure existing ones are removed by innerHTML clearing)
        document.querySelectorAll('.edit-btn').forEach(button => button.addEventListener('click', openEditModal));
        document.querySelectorAll('.delete-btn').forEach(button => button.addEventListener('click', deleteTask));

        renderDashboardSummary();
    }

    function renderDashboardSummary() {
        const today = new Date().toISOString().split('T')[0];
        const totalCount = tasks.length;
        const todoCount = tasks.filter(task => task.status === 'todo').length;
        const inProgressCount = tasks.filter(task => task.status === 'inprogress').length;
        const doneCount = tasks.filter(task => task.status === 'done').length;
        const highPriorityCount = tasks.filter(task => task.priority === 'high').length;
        const overdueCount = tasks.filter(task => task.status !== 'done' && task.dueDate && task.dueDate < today).length;

        totalCountElement.textContent = totalCount;
        todoCountElement.textContent = todoCount;
        inProgressCountElement.textContent = inProgressCount;
        doneCountElement.textContent = doneCount;
        highPriorityCountElement.textContent = highPriorityCount;
        overdueCountElement.textContent = overdueCount;

        const completionRate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
        completionBar.style.width = `${completionRate}%`;
        completionText.textContent = `${completionRate}% Completed`;

        const highPriorityPercentage = totalCount > 0 ? (highPriorityCount / totalCount) * 100 : 0;
        const mediumPriorityPercentage = totalCount > 0 ? (tasks.filter(task => task.priority === 'medium').length / totalCount) * 100 : 0;
        const lowPriorityPercentage = totalCount > 0 ? (tasks.filter(task => task.priority === 'low').length / totalCount) * 100 : 0;

        highPriorityBar.style.width = `${highPriorityPercentage}%`;
        mediumPriorityBar.style.width = `${mediumPriorityPercentage}%`;
        lowPriorityBar.style.width = `${lowPriorityPercentage}%`;
    }

    // --- Drag & Drop ---
    let draggedTaskKanban = null;

    function dragStart(event) {
        const taskId = event.target.dataset.id;
        const task = tasks.find(t => t.id === taskId);

        // Prevent dragging if task is locked by another user on a collaborative board
        if (currentBoardCollaborative && task.lockedBy && task.lockedBy !== userId) {
            event.preventDefault();
            showCustomModal("This task is currently locked by another user and cannot be moved.", "Task Locked", 'alert');
            return;
        }

        draggedTaskKanban = event.target;
        setTimeout(() => draggedTaskKanban.classList.add('dragging'), 0);
        event.dataTransfer.setData('text/plain', taskId);
        console.log("Drag started for task ID:", taskId);
    }

    function dragEnd() {
        if (draggedTaskKanban) {
            draggedTaskKanban.classList.remove('dragging');
        }
        draggedTaskKanban = null;
        console.log("Drag ended.");
    }

    window.dragOver = function (event) {
        event.preventDefault();
    };

    window.drop = async function (event, newStatus) {
        event.preventDefault();
        const taskId = event.dataTransfer.getData('text/plain');
        console.log(`Drop event: Task ID ${taskId} to new status ${newStatus}`);
        const taskRef = doc(db, 'boards', boardId, 'tasks', taskId);

        const task = tasks.find(t => t.id === taskId);
        // Prevent dropping if task is locked by another user on a collaborative board
        if (currentBoardCollaborative && task.lockedBy && task.lockedBy !== userId) {
            showCustomModal("This task is currently locked by another user and cannot be moved.", "Task Locked", 'alert');
            return;
        }

        const updateData = { status: newStatus };

        if (newStatus === 'done') {
            updateData.completionDate = new Date().toISOString().split('T')[0];
            console.log("Setting completionDate for 'done' status.");
        } else {
            // Explicitly clear completion date if not 'done'
            updateData.completionDate = deleteField();
            console.log("Removing completionDate as status is not 'done'.");
        }

        try {
            await updateDoc(taskRef, updateData);
            console.log("Task status updated successfully in Firestore.");
        } catch (error) {
            console.error("Error updating task status:", error);
            showCustomModal("Task could not be moved. Please try again.", "Error", 'alert');
        }
    };

    // --- Share Functionality ---
    function openShareModal() {
        console.log("Share button clicked. Current board ID:", boardId);
        if (!boardId) {
            showCustomModal("Create a board or join one to share it.", "Board not active", 'alert');
            return;
        }
        if (!currentBoardCollaborative) {
            showCustomModal("This is a solo board and cannot be shared. Please create a collaborative board if you wish to share.", "Sharing Not Allowed", 'alert');
            return;
        }

        const link = `${window.location.origin}${window.location.pathname}?board=${boardId}`;
        shareableLinkInput.value = link;
        shareableBoardIdInput.value = boardId;
        shareModal.style.display = 'flex';
        console.log("Share modal opened. Link:", link);
    }

    function closeShareModal() {
        shareModal.style.display = 'none';
        console.log("Share modal closed.");
    }

    shareBoardBtn.addEventListener('click', openShareModal);
    closeShareModalBtn.addEventListener('click', closeShareModal);

    copyLinkBtn.addEventListener('click', () => {
        shareableLinkInput.select();
        document.execCommand('copy');
        copyLinkBtn.textContent = 'Copied!';
        console.log("Share link copied to clipboard.");
        setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
    });

});