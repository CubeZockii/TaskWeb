// TaskWeb - Single File Version
// All modules consolidated for easier deployment

// ==========================================
// CONFIGURATION
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyDNY51Jui8EOiCGQMdpLsn2kW4yTPYkk2w",
  authDomain: "taskflow-841c1.firebaseapp.com",
  projectId: "taskflow-841c1",
  storageBucket: "taskflow-841c1.firebasestorage.app",
  messagingSenderId: "109204779254",
  appId: "1:109204779254:web:ed340a07677a37fa8277cd7",
};

// ==========================================
// GLOBAL STATE
// ==========================================
const AppState = {
  user: null,
  board: null,
  columns: [],
  tasks: [],
  activeUsers: [],
  currentView: "dashboard",
  editingTask: null,
  listeners: [],

  setUser(user) {
    this.user = user;
    this.notify("user");
  },

  setBoard(board) {
    this.board = board;
    this.notify("board");
  },

  setColumns(columns) {
    this.columns = columns.sort((a, b) => a.order - b.order);
    this.notify("columns");
  },

  setTasks(tasks) {
    this.tasks = tasks;
    this.notify("tasks");
  },

  setActiveUsers(users) {
    this.activeUsers = users;
    this.notify("activeUsers");
  },

  setView(view) {
    this.currentView = view;
    this.notify("view");
  },

  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  },

  notify(change) {
    this.listeners.forEach((l) => l(change, this));
  },
};

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
let app, db, auth;
let presenceInterval = null;
let unsubscribePresence = null;
let boardUnsubscribe = null;
let columnsUnsubscribe = null;
let tasksUnsubscribe = null;
let columnSortable = null;
let taskSortables = [];

async function initializeFirebase() {
  const { initializeApp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js");

  let config = firebaseConfig;
  if (typeof __firebase_config !== "undefined" && __firebase_config) {
    try {
      config = JSON.parse(__firebase_config);
    } catch (e) {
      console.warn("Error parsing env config, using fallback");
    }
  }

  app = initializeApp(config);

  const { getFirestore } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
  const { getAuth } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js");

  db = getFirestore(app);
  auth = getAuth(app);

  return { app, db, auth };
}

// ==========================================
// AUTHENTICATION SERVICE
// ==========================================
async function initializeAuth() {
  const { onAuthStateChanged, signInAnonymously, signInWithCustomToken } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js");

  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        AppState.setUser({
          uid: user.uid,
          isAnonymous: user.isAnonymous,
        });
        resolve(user);
      } else {
        try {
          if (
            typeof __initial_auth_token !== "undefined" &&
            __initial_auth_token
          ) {
            await signInWithCustomToken(auth, __initial_auth_token);
          } else {
            await signInAnonymously(auth);
          }
        } catch (error) {
          console.error("Auth error:", error);
          await signInAnonymously(auth);
        }
      }
    });
  });
}

async function setupPresence(boardId) {
  if (!auth.currentUser || !boardId) return;

  const { doc, setDoc, deleteDoc, onSnapshot, collection, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  if (unsubscribePresence) {
    unsubscribePresence();
    clearInterval(presenceInterval);
  }

  const userId = auth.currentUser.uid;
  const presenceRef = doc(db, "boardPresence", boardId, "users", userId);

  const updatePresence = async () => {
    try {
      await setDoc(
        presenceRef,
        {
          userId,
          lastActive: serverTimestamp(),
          joinedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (e) {
      console.error("Presence update failed:", e);
    }
  };

  await updatePresence();
  presenceInterval = setInterval(updatePresence, 10000);

  const presenceCol = collection(db, "boardPresence", boardId, "users");
  unsubscribePresence = onSnapshot(presenceCol, (snapshot) => {
    const now = Date.now();
    const activeUsers = snapshot.docs
      .map((d) => d.data())
      .filter((u) => u.lastActive && now - u.lastActive.toMillis() < 15000)
      .map((u) => u.userId);

    AppState.setActiveUsers(activeUsers);
  });

  window.addEventListener("beforeunload", async () => {
    try {
      await deleteDoc(presenceRef);
    } catch (e) {
      console.warn("Failed to cleanup presence:", e);
    }
  });
}

function cleanupPresence() {
  if (unsubscribePresence) {
    unsubscribePresence();
    unsubscribePresence = null;
  }
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
}

// ==========================================
// BOARD SERVICE
// ==========================================
async function loadBoard(boardId, isFromURL = false) {
  const { doc, getDoc, onSnapshot, collection, query, where, getDocs } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  try {
    const boardRef = doc(db, "boards", boardId);
    const boardSnap = await getDoc(boardRef);

    if (!boardSnap.exists()) {
      throw new Error("Board not found");
    }

    const boardData = boardSnap.data();
    const userId = auth.currentUser.uid;

    const isOwner = boardData.owner === userId;
    const canAccess = isOwner || (boardData.isCollaborative && isFromURL);

    if (!canAccess) {
      throw new Error("Access denied");
    }

    const board = {
      id: boardId,
      ...boardData,
      isOwner,
    };

    AppState.setBoard(board);

    if (boardUnsubscribe) boardUnsubscribe();
    if (columnsUnsubscribe) columnsUnsubscribe();

    boardUnsubscribe = onSnapshot(boardRef, (snap) => {
      if (snap.exists()) {
        AppState.setBoard({
          id: boardId,
          ...snap.data(),
          isOwner: snap.data().owner === userId,
        });
      }
    });

    const columnsQuery = query(collection(db, "boards", boardId, "columns"));
    columnsUnsubscribe = onSnapshot(columnsQuery, (snap) => {
      const columns = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      AppState.setColumns(columns);
    });

    if (boardData.isCollaborative) {
      await setupPresence(boardId);
    }

    window.history.pushState({}, "", `?board=${boardId}`);

    return board;
  } catch (error) {
    console.error("Error loading board:", error);
    throw error;
  }
}

async function createBoard(isCollaborative, name = null) {
  const { collection, doc, setDoc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  const userId = auth.currentUser.uid;

  if (!isCollaborative) {
    const { query, where, getDocs } =
      await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
    const existingQuery = query(
      collection(db, "boards"),
      where("owner", "==", userId),
      where("isCollaborative", "==", false),
    );
    const existing = await getDocs(existingQuery);

    if (!existing.empty) {
      throw new Error("Solo board already exists");
    }
  }

  const boardRef = doc(collection(db, "boards"));
  const boardId = boardRef.id;
  const boardName =
    name ||
    (isCollaborative
      ? `Collaborative Board ${new Date().toLocaleDateString()}`
      : "My Solo Board");

  await setDoc(boardRef, {
    name: boardName,
    owner: userId,
    isCollaborative,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const columnsCol = collection(db, "boards", boardId, "columns");
  const defaultColumns = [
    { title: "To Do", order: 0, createdAt: serverTimestamp() },
    { title: "In Progress", order: 1, createdAt: serverTimestamp() },
    { title: "Done", order: 2, createdAt: serverTimestamp() },
  ];

  for (const col of defaultColumns) {
    const colRef = doc(columnsCol);
    await setDoc(colRef, col);
  }

  return boardId;
}

async function updateBoard(boardId, updates) {
  const { updateDoc, doc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
  const boardRef = doc(db, "boards", boardId);
  await updateDoc(boardRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

async function deleteBoard(boardId) {
  const { deleteDoc, doc, collection, getDocs, writeBatch } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  const batch = writeBatch(db);

  const tasksSnap = await getDocs(collection(db, "boards", boardId, "tasks"));
  tasksSnap.forEach((d) => batch.delete(d.ref));

  const colsSnap = await getDocs(collection(db, "boards", boardId, "columns"));
  colsSnap.forEach((d) => batch.delete(d.ref));

  await batch.commit();
  await deleteDoc(doc(db, "boards", boardId));
}

async function createColumn(boardId, title) {
  const { collection, doc, setDoc, serverTimestamp, getDocs } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  const columnsCol = collection(db, "boards", boardId, "columns");
  const snapshot = await getDocs(columnsCol);
  const maxOrder = snapshot.docs.reduce(
    (max, d) => Math.max(max, d.data().order || 0),
    -1,
  );

  const colRef = doc(columnsCol);
  await setDoc(colRef, {
    title,
    order: maxOrder + 1,
    createdAt: serverTimestamp(),
  });

  return colRef.id;
}

async function updateColumn(boardId, columnId, updates) {
  const { updateDoc, doc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
  const colRef = doc(db, "boards", boardId, "columns", columnId);
  await updateDoc(colRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

async function deleteColumn(boardId, columnId) {
  const { deleteDoc, doc, collection, getDocs, query, where } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  const tasksQuery = query(
    collection(db, "boards", boardId, "tasks"),
    where("columnId", "==", columnId),
  );
  const tasksSnap = await getDocs(tasksQuery);

  if (!tasksSnap.empty) {
    throw new Error("Column contains tasks");
  }

  await deleteDoc(doc(db, "boards", boardId, "columns", columnId));
}

async function reorderColumns(boardId, columnIds) {
  const { writeBatch, doc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  const batch = writeBatch(db);
  columnIds.forEach((id, index) => {
    const ref = doc(db, "boards", boardId, "columns", id);
    batch.update(ref, { order: index, updatedAt: serverTimestamp() });
  });

  await batch.commit();
}

async function fetchUserBoards() {
  const { collection, query, where, getDocs, orderBy } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  const userId = auth.currentUser.uid;
  const q = query(
    collection(db, "boards"),
    where("owner", "==", userId),
    orderBy("createdAt", "desc"),
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));
}

function cleanupBoard() {
  if (boardUnsubscribe) {
    boardUnsubscribe();
    boardUnsubscribe = null;
  }
  if (columnsUnsubscribe) {
    columnsUnsubscribe();
    columnsUnsubscribe = null;
  }
}

// ==========================================
// TASK SERVICE
// ==========================================
async function listenToTasks(boardId) {
  const { collection, query, onSnapshot, orderBy } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  if (tasksUnsubscribe) {
    tasksUnsubscribe();
  }

  const tasksQuery = query(
    collection(db, "boards", boardId, "tasks"),
    orderBy("createdAt", "desc"),
  );

  tasksUnsubscribe = onSnapshot(tasksQuery, (snapshot) => {
    const tasks = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    AppState.setTasks(tasks);
  });
}

async function createTask(boardId, taskData) {
  const { collection, addDoc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  const tasksCol = collection(db, "boards", boardId, "tasks");
  const docRef = await addDoc(tasksCol, {
    ...taskData,
    createdBy: auth.currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lockedBy: null,
  });

  return docRef.id;
}

async function updateTask(boardId, taskId, updates, skipLockCheck = false) {
  const { updateDoc, doc, getDoc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  const taskRef = doc(db, "boards", boardId, "tasks", taskId);

  if (!skipLockCheck) {
    const snap = await getDoc(taskRef);
    if (!snap.exists()) throw new Error("Task not found");

    const data = snap.data();
    if (data.lockedBy && data.lockedBy !== auth.currentUser.uid) {
      throw new Error("Task is locked by another user");
    }
  }

  await updateDoc(taskRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

async function deleteTask(boardId, taskId) {
  const { deleteDoc, doc } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
  await deleteDoc(doc(db, "boards", boardId, "tasks", taskId));
}

async function lockTask(boardId, taskId) {
  const { updateDoc, doc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
  await updateDoc(doc(db, "boards", boardId, "tasks", taskId), {
    lockedBy: auth.currentUser.uid,
    updatedAt: serverTimestamp(),
  });
}

async function unlockTask(boardId, taskId) {
  const { updateDoc, doc, serverTimestamp, deleteField } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
  await updateDoc(doc(db, "boards", boardId, "tasks", taskId), {
    lockedBy: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

async function moveTask(boardId, taskId, newColumnId, newOrder) {
  const { updateDoc, doc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
  await updateDoc(doc(db, "boards", boardId, "tasks", taskId), {
    columnId: newColumnId,
    order: newOrder,
    updatedAt: serverTimestamp(),
  });
}

function cleanupTasks() {
  if (tasksUnsubscribe) {
    tasksUnsubscribe();
    tasksUnsubscribe = null;
  }
}

// ==========================================
// DRAG AND DROP (SortableJS)
// ==========================================
async function initializeDragAndDrop(boardId) {
  cleanupDrag();

  const boardContainer = document.getElementById("boardContainer");
  if (!boardContainer) return;

  const { default: Sortable } =
    await import("https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.complete.esm.js");

  columnSortable = new Sortable(boardContainer, {
    animation: 200,
    handle: ".column-header",
    draggable: ".kanban-column",
    ghostClass: "sortable-ghost",
    dragClass: "sortable-drag",
    onEnd: async (evt) => {
      const columns = Array.from(
        boardContainer.querySelectorAll(".kanban-column"),
      );
      const columnIds = columns.map((col) => col.dataset.id);

      try {
        await reorderColumns(boardId, columnIds);
      } catch (error) {
        console.error("Failed to reorder columns:", error);
        initializeDragAndDrop(boardId);
      }
    },
  });

  initializeTaskSortables(boardId, Sortable);

  return AppState.subscribe((change) => {
    if (change === "columns") {
      setTimeout(() => initializeTaskSortables(boardId, Sortable), 0);
    }
  });
}

async function initializeTaskSortables(boardId, Sortable) {
  taskSortables.forEach((s) => s.destroy());
  taskSortables = [];

  const taskLists = document.querySelectorAll(".task-list");

  taskLists.forEach((list) => {
    const sortable = new Sortable(list, {
      group: "tasks",
      animation: 200,
      delay: 0,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      ghostClass: "sortable-ghost",
      dragClass: "sortable-drag",
      forceFallback: true,
      fallbackClass: "dragging",
      onStart: (evt) => {
        evt.item.classList.add("dragging");
      },
      onEnd: async (evt) => {
        evt.item.classList.remove("dragging");

        const taskId = evt.item.dataset.id;
        const newColumnId = evt.to.closest(".kanban-column").dataset.id;
        const newIndex = evt.newIndex;

        try {
          await moveTask(boardId, taskId, newColumnId, newIndex);
        } catch (error) {
          console.error("Failed to move task:", error);
        }
      },
    });

    taskSortables.push(sortable);
  });
}

function cleanupDrag() {
  if (columnSortable) {
    columnSortable.destroy();
    columnSortable = null;
  }
  taskSortables.forEach((s) => s.destroy());
  taskSortables = [];
}

// ==========================================
// UI RENDERER
// ==========================================
function renderDashboard() {
  const tasks = AppState.tasks;
  const columns = AppState.columns;

  const total = tasks.length;
  const highPriority = tasks.filter((t) => t.priority === "high").length;
  const completed = tasks.filter((t) => {
    const col = columns.find((c) => c.id === t.columnId);
    return col && col.title.toLowerCase() === "done";
  }).length;

  const today = new Date().toISOString().split("T")[0];
  const overdue = tasks.filter((t) => {
    if (!t.dueDate || t.status === "done") return false;
    return t.dueDate < today;
  }).length;

  document.getElementById("totalTasks").textContent = total;
  document.getElementById("highPriorityTasks").textContent = highPriority;
  document.getElementById("overdueTasks").textContent = overdue;
  document.getElementById("completedTasks").textContent = completed;

  const columnChart = document.getElementById("columnChart");
  columnChart.innerHTML = "";

  const maxCount = Math.max(
    ...columns.map((c) => tasks.filter((t) => t.columnId === c.id).length),
    1,
  );

  columns.forEach((col) => {
    const count = tasks.filter((t) => t.columnId === col.id).length;
    const percentage = (count / maxCount) * 100;

    const stat = document.createElement("div");
    stat.className = "column-stat";
    stat.innerHTML = `
            <span class="column-name">${escapeHtml(col.title)}</span>
            <div class="column-bar-bg">
                <div class="column-bar-fill" style="width: ${percentage}%"></div>
            </div>
            <span class="column-count">${count}</span>
        `;
    columnChart.appendChild(stat);
  });

  const priorities = ["high", "medium", "low"];
  const totalPrio = tasks.length || 1;

  priorities.forEach((p) => {
    const count = tasks.filter((t) => t.priority === p).length;
    const bar = document.getElementById(
      `priority${p.charAt(0).toUpperCase() + p.slice(1)}`,
    );
    const countEl = document.getElementById(
      `count${p.charAt(0).toUpperCase() + p.slice(1)}`,
    );

    if (bar && countEl) {
      bar.style.width = `${(count / totalPrio) * 100}%`;
      countEl.textContent = count;
    }
  });

  const recentList = document.getElementById("recentTasksList");
  recentList.innerHTML = "";

  const recent = [...tasks]
    .sort(
      (a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0),
    )
    .slice(0, 5);

  recent.forEach((task) => {
    const col = columns.find((c) => c.id === task.columnId);
    const item = document.createElement("div");
    item.className = "task-item";
    item.innerHTML = `
            <span class="task-priority-dot ${task.priority}"></span>
            <div class="task-content">
                <div class="task-title">${escapeHtml(task.title)}</div>
                <div class="task-meta">${col ? escapeHtml(col.title) : "Unknown"}</div>
            </div>
        `;
    recentList.appendChild(item);
  });
}

function renderBoard(boardId) {
  const container = document.getElementById("boardContainer");
  const columns = AppState.columns;
  const tasks = AppState.tasks;
  const currentUser = AppState.user;

  const addBtn = document.getElementById("addListBtn");
  container.innerHTML = "";

  columns.forEach((column) => {
    const columnTasks = tasks
      .filter((t) => t.columnId === column.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const colEl = document.createElement("div");
    colEl.className = "kanban-column";
    colEl.dataset.id = column.id;

    colEl.innerHTML = `
            <div class="column-header">
                <div class="column-title-wrapper">
                    <input type="text" class="column-title" value="${escapeHtml(column.title)}" 
                        ${AppState.board?.isOwner ? "" : "readonly"}>
                    <span class="task-count">${columnTasks.length}</span>
                </div>
                ${
                  AppState.board?.isOwner
                    ? `
                    <div class="column-actions">
                        <button class="column-btn delete" data-action="delete-column" data-id="${column.id}" title="Delete column">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </div>
                `
                    : ""
                }
            </div>
            <div class="task-list" data-column-id="${column.id}">
                ${columnTasks
                  .map((task) => {
                    const locked =
                      task.lockedBy && task.lockedBy !== currentUser?.uid;
                    const isOverdue =
                      task.dueDate &&
                      task.dueDate < new Date().toISOString().split("T")[0] &&
                      !task.completed;

                    return `
                        <div class="task-card priority-${task.priority} ${locked ? "locked" : ""}" 
                             data-id="${task.id}" draggable="${!locked}">
                            <div class="task-card-header">
                                <div class="task-card-title">${escapeHtml(task.title)}</div>
                                ${
                                  locked
                                    ? `
                                    <svg class="task-lock-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                        <path d="M7 11V7a5 5 0 0110 0v4"/>
                                    </svg>
                                `
                                    : ""
                                }
                            </div>
                            ${task.description ? `<div class="task-card-desc">${escapeHtml(task.description)}</div>` : ""}
                            <div class="task-card-footer">
                                <div class="task-card-meta">
                                    ${
                                      task.dueDate
                                        ? `
                                        <span class="task-meta-item ${isOverdue ? "overdue" : ""}">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                                <line x1="16" y1="2" x2="16" y2="6"/>
                                                <line x1="8" y1="2" x2="8" y2="6"/>
                                                <line x1="3" y1="10" x2="21" y2="10"/>
                                            </svg>
                                            ${formatDate(task.dueDate)}
                                        </span>
                                    `
                                        : ""
                                    }
                                </div>
                                <div class="task-card-actions">
                                    <button class="task-action-btn edit" data-action="edit-task" data-id="${task.id}" ${locked ? "disabled" : ""}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>
                                    </button>
                                    <button class="task-action-btn delete" data-action="delete-task" data-id="${task.id}" ${locked ? "disabled" : ""}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                  })
                  .join("")}
            </div>
        `;

    const titleInput = colEl.querySelector(".column-title");
    if (AppState.board?.isOwner) {
      titleInput.addEventListener("change", async (e) => {
        await updateColumn(boardId, column.id, { title: e.target.value });
      });
    }

    container.appendChild(colEl);
  });

  container.appendChild(addBtn);
}

function updateActiveUsers() {
  const users = AppState.activeUsers;
  const countEl = document.getElementById("activeUserCount");
  const avatarsEl = document.getElementById("userAvatars");
  const row = document.getElementById("activeUsersRow");

  if (!AppState.board?.isCollaborative) {
    row.style.display = "none";
    return;
  }

  row.style.display = "flex";
  countEl.textContent = users.length;

  avatarsEl.innerHTML = users
    .slice(0, 3)
    .map(
      (uid, i) => `
        <div class="user-avatar-small" style="z-index: ${3 - i}">
            ${uid.substring(0, 2).toUpperCase()}
        </div>
    `,
    )
    .join("");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icons = {
    success:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>',
    error:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  };

  toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ==========================================
// MAIN APPLICATION
// ==========================================
async function init() {
  try {
    await initializeFirebase();
    await initializeAuth();

    setupEventListeners();
    setupStateSubscriptions();

    const params = new URLSearchParams(window.location.search);
    const boardId = params.get("board");

    if (boardId) {
      await loadAndSetupBoard(boardId, true);
    } else {
      showBoardModal();
    }
  } catch (error) {
    console.error("Initialization error:", error);
    showToast("Failed to initialize app", "error");
  }
}

function setupStateSubscriptions() {
  AppState.subscribe((change, state) => {
    if (change === "tasks" || change === "columns") {
      if (AppState.currentView === "dashboard") {
        renderDashboard();
      } else {
        renderBoard(state.board?.id);
      }
    }

    if (change === "activeUsers") {
      updateActiveUsers();
    }

    if (change === "board") {
      updateBoardUI();
    }
  });
}

function updateBoardUI() {
  const board = AppState.board;
  if (!board) return;

  document.getElementById("boardIdDisplay").textContent =
    board.id.substring(0, 8) + "...";
  document.getElementById("boardTypeDisplay").textContent =
    board.isCollaborative ? "Collaborative" : "Solo";
  document.getElementById("shareBoardBtn").style.display = board.isCollaborative
    ? "flex"
    : "none";
  document.getElementById("userIdDisplay").textContent =
    AppState.user?.uid.substring(0, 8) + "...";

  const avatar = document.getElementById("userAvatar");
  avatar.textContent = AppState.user?.uid.substring(0, 2).toUpperCase();
}

async function loadAndSetupBoard(boardId, isFromURL = false) {
  try {
    cleanupDrag();
    cleanupTasks();

    const board = await loadBoard(boardId, isFromURL);
    listenToTasks(boardId);

    AppState.dragUnsubscribe = initializeDragAndDrop(boardId);

    switchView("board");
  } catch (error) {
    console.error("Error loading board:", error);
    showToast(error.message, "error");
    showBoardModal();
  }
}

function setupEventListeners() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.dataset.view;
      switchView(view);
    });
  });

  document
    .getElementById("menuToggle")
    ?.addEventListener("click", toggleSidebar);
  document
    .getElementById("sidebarClose")
    ?.addEventListener("click", toggleSidebar);
  document
    .getElementById("sidebarOverlay")
    ?.addEventListener("click", toggleSidebar);

  document
    .getElementById("createTaskBtn")
    ?.addEventListener("click", openTaskModal);
  document
    .getElementById("closeTaskModal")
    ?.addEventListener("click", closeTaskModal);
  document
    .getElementById("cancelTask")
    ?.addEventListener("click", closeTaskModal);
  document
    .getElementById("saveTask")
    ?.addEventListener("click", saveTaskHandler);

  document.querySelectorAll(".priority-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".priority-option")
        .forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });

  document
    .getElementById("manageBoardsBtn")
    ?.addEventListener("click", showBoardModal);
  document
    .getElementById("closeBoardModal")
    ?.addEventListener("click", hideBoardModal);
  document
    .getElementById("createSoloBtn")
    ?.addEventListener("click", () => createNewBoard(false));
  document
    .getElementById("createCollabBtn")
    ?.addEventListener("click", () => createNewBoard(true));
  document
    .getElementById("joinBoardBtn")
    ?.addEventListener("click", joinBoardHandler);

  document
    .getElementById("shareBoardBtn")
    ?.addEventListener("click", showShareModal);
  document
    .getElementById("closeShareModal")
    ?.addEventListener("click", hideShareModal);
  document
    .getElementById("copyLinkBtn")
    ?.addEventListener("click", copyShareLink);

  document
    .getElementById("addListBtn")
    ?.addEventListener("click", addListHandler);

  document
    .getElementById("boardContainer")
    ?.addEventListener("click", handleBoardClick);

  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal")) {
      e.target.classList.remove("active");
    }
  });
}

function switchView(view) {
  AppState.setView(view);

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });

  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.remove("active");
  });
  document.getElementById(view + "View")?.classList.add("active");

  const titles = {
    dashboard: "Dashboard",
    board: AppState.board?.name || "Board",
  };
  document.getElementById("pageTitle").textContent = titles[view];

  if (view === "dashboard") {
    renderDashboard();
  } else {
    renderBoard(AppState.board?.id);
  }

  if (window.innerWidth <= 1024) {
    toggleSidebar(false);
  }
}

function toggleSidebar(forceState) {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const isOpen = sidebar.classList.contains("open");
  const shouldOpen = forceState !== undefined ? forceState : !isOpen;

  sidebar.classList.toggle("open", shouldOpen);
  overlay.classList.toggle("active", shouldOpen);
}

// Task Modal
function openTaskModal(taskId = null) {
  const modal = document.getElementById("taskModal");
  const title = document.getElementById("modalTitle");
  const warning = document.getElementById("lockWarning");

  const colSelect = document.getElementById("taskColumn");
  colSelect.innerHTML = AppState.columns
    .map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`)
    .join("");

  if (taskId) {
    const task = AppState.tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (task.lockedBy && task.lockedBy !== AppState.user?.uid) {
      warning.style.display = "flex";
      document.getElementById("taskTitle").disabled = true;
      document.getElementById("taskDesc").disabled = true;
      document.getElementById("saveTask").disabled = true;
    } else {
      warning.style.display = "none";
      document.getElementById("taskTitle").disabled = false;
      document.getElementById("taskDesc").disabled = false;
      document.getElementById("saveTask").disabled = false;
      lockTask(AppState.board.id, taskId);
    }

    title.textContent = "Edit Task";
    document.getElementById("taskTitle").value = task.title;
    document.getElementById("taskDesc").value = task.description || "";
    document.getElementById("taskDue").value = task.dueDate || "";
    document.getElementById("taskColumn").value = task.columnId;

    document.querySelectorAll(".priority-option").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.value === task.priority);
    });

    AppState.editingTask = taskId;
  } else {
    title.textContent = "Create Task";
    warning.style.display = "none";
    document.getElementById("taskTitle").value = "";
    document.getElementById("taskDesc").value = "";
    document.getElementById("taskDue").value = "";
    document.getElementById("taskTitle").disabled = false;
    document.getElementById("taskDesc").disabled = false;
    document.getElementById("saveTask").disabled = false;

    document.querySelectorAll(".priority-option").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.value === "medium");
    });

    AppState.editingTask = null;
  }

  modal.classList.add("active");
}

async function closeTaskModal() {
  const modal = document.getElementById("taskModal");
  modal.classList.remove("active");

  if (AppState.editingTask && AppState.board) {
    await unlockTask(AppState.board.id, AppState.editingTask);
  }

  AppState.editingTask = null;
}

async function saveTaskHandler() {
  const title = document.getElementById("taskTitle").value.trim();
  if (!title) {
    showToast("Title is required", "error");
    return;
  }

  const priority =
    document.querySelector(".priority-option.selected")?.dataset.value ||
    "medium";
  const description = document.getElementById("taskDesc").value.trim();
  const dueDate = document.getElementById("taskDue").value;
  const columnId = document.getElementById("taskColumn").value;

  const taskData = {
    title,
    description,
    priority,
    dueDate,
    columnId,
  };

  try {
    if (AppState.editingTask) {
      await updateTask(AppState.board.id, AppState.editingTask, taskData, true);
      showToast("Task updated", "success");
    } else {
      await createTask(AppState.board.id, taskData);
      showToast("Task created", "success");
    }
    closeTaskModal();
  } catch (error) {
    showToast(error.message, "error");
  }
}

// Board Management
async function showBoardModal() {
  const modal = document.getElementById("boardModal");
  const grid = document.getElementById("boardsGrid");

  try {
    const boards = await fetchUserBoards();

    grid.innerHTML = boards
      .map(
        (board) => `
            <div class="glass-card board-card ${board.isCollaborative ? "collaborative" : "solo"} ${board.id === AppState.board?.id ? "active" : ""}" 
                 data-id="${board.id}">
                <div class="board-card-title">${escapeHtml(board.name)}</div>
                <div class="board-card-meta">
                    <span>${board.isCollaborative ? "👥 Collaborative" : "👤 Solo"}</span>
                    <span>${new Date(board.createdAt?.toMillis()).toLocaleDateString()}</span>
                </div>
                <div class="board-card-actions">
                    <button class="btn secondary" data-action="load" data-id="${board.id}">Open</button>
                    <button class="btn danger" data-action="delete-board" data-id="${board.id}">Delete</button>
                </div>
            </div>
        `,
      )
      .join("");

    grid.querySelectorAll(".board-card").forEach((card) => {
      card.addEventListener("click", async (e) => {
        if (e.target.closest("button")) return;
        const id = card.dataset.id;
        await loadAndSetupBoard(id);
        hideBoardModal();
      });
    });
  } catch (error) {
    console.error("Error fetching boards:", error);
  }

  modal.classList.add("active");
}

function hideBoardModal() {
  document.getElementById("boardModal").classList.remove("active");
}

async function createNewBoard(isCollaborative) {
  try {
    const name = isCollaborative
      ? prompt("Enter board name:") ||
        `Collaborative Board ${new Date().toLocaleDateString()}`
      : null;

    const boardId = await createBoard(isCollaborative, name);
    await loadAndSetupBoard(boardId);
    hideBoardModal();
    showToast("Board created", "success");
  } catch (error) {
    if (error.message === "Solo board already exists") {
      showToast("You already have a solo board", "warning");
    } else {
      showToast(error.message, "error");
    }
  }
}

async function joinBoardHandler() {
  const input = document.getElementById("joinBoardId");
  const boardId = input.value.trim();

  if (!boardId) {
    showToast("Please enter a board ID", "error");
    return;
  }

  try {
    await loadAndSetupBoard(boardId, true);
    hideBoardModal();
    input.value = "";
  } catch (error) {
    showToast("Failed to join board", "error");
  }
}

// Share
function showShareModal() {
  const modal = document.getElementById("shareModal");
  const link = `${window.location.origin}${window.location.pathname}?board=${AppState.board.id}`;

  document.getElementById("shareLink").value = link;
  document.getElementById("shareBoardId").textContent = AppState.board.id;

  modal.classList.add("active");
}

function hideShareModal() {
  document.getElementById("shareModal").classList.remove("active");
}

async function copyShareLink() {
  const input = document.getElementById("shareLink");
  input.select();

  try {
    await navigator.clipboard.writeText(input.value);
    showToast("Link copied", "success");
  } catch (err) {
    document.execCommand("copy");
    showToast("Link copied", "success");
  }
}

// Column Management
async function addListHandler() {
  if (!AppState.board?.isOwner) {
    showToast("Only board owner can add columns", "error");
    return;
  }

  const title = prompt("Enter list name:");
  if (!title?.trim()) return;

  try {
    await createColumn(AppState.board.id, title.trim());
    showToast("List created", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

// Board click delegation
async function handleBoardClick(e) {
  const target = e.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;

  switch (action) {
    case "edit-task":
      openTaskModal(id);
      break;

    case "delete-task":
      if (confirm("Delete this task?")) {
        try {
          await deleteTask(AppState.board.id, id);
          showToast("Task deleted", "success");
        } catch (error) {
          showToast(error.message, "error");
        }
      }
      break;

    case "delete-column":
      if (confirm("Delete this list? All tasks will be lost.")) {
        try {
          await deleteColumn(AppState.board.id, id);
          showToast("List deleted", "success");
        } catch (error) {
          if (error.message === "Column contains tasks") {
            showToast("Move or delete tasks first", "warning");
          } else {
            showToast(error.message, "error");
          }
        }
      }
      break;

    case "load":
      await loadAndSetupBoard(id);
      hideBoardModal();
      break;

    case "delete-board":
      if (confirm("Delete this board permanently?")) {
        try {
          await deleteBoard(id);
          if (AppState.board?.id === id) {
            cleanupPresence();
            AppState.setBoard(null);
            showBoardModal();
          }
          showToast("Board deleted", "success");
          showBoardModal();
        } catch (error) {
          showToast(error.message, "error");
        }
      }
      break;
  }
}

// Start the app
document.addEventListener("DOMContentLoaded", init);
