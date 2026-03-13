const POPUP_ID = "dictionary-popup";

const popupState = {
  view: "definition",
  word: "",
  definition: "",
  history: [],
  loading: false,
  loadingMessage: "",
  status: ""
};

chrome.runtime.onMessage.addListener((request) => {
  if (request?.action !== "showDefinition") {
    return;
  }

  popupState.view = "definition";
  popupState.word = request.word;
  popupState.definition = request.definition;
  popupState.loading = false;
  popupState.loadingMessage = "";
  popupState.status = "";

  renderPopup();
});

function getOrCreatePopup() {
  let popup = document.getElementById(POPUP_ID);
  if (popup) {
    return popup;
  }

  popup = document.createElement("div");
  popup.id = POPUP_ID;
  popup.className = "dictionary-popup";
  document.body.appendChild(popup);
  return popup;
}

function createButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderPopup() {
  const popup = getOrCreatePopup();
  const card = document.createElement("div");
  card.className = "dictionary-popup__content";

  const closeButton = createButton("X", "dictionary-popup__close", () => {
    popup.remove();
  });
  closeButton.setAttribute("aria-label", "Close popup");

  card.appendChild(closeButton);

  if (popupState.view === "history") {
    renderHistoryView(card);
  } else {
    renderDefinitionView(card);
  }

  popup.replaceChildren(card);
}

function renderDefinitionView(card) {
  const controls = document.createElement("div");
  controls.className = "dictionary-popup__toolbar";

  const historyButton = createButton(
    "History",
    "dictionary-popup__action",
    () => {
      void showHistory();
    }
  );

  controls.appendChild(historyButton);

  const title = document.createElement("h3");
  title.className = "dictionary-popup__title";
  title.textContent = popupState.word;

  const definitionText = document.createElement("p");
  definitionText.className = "dictionary-popup__definition";
  definitionText.textContent = popupState.definition;

  card.append(controls, title, definitionText);
}

function renderHistoryView(card) {
  const controls = document.createElement("div");
  controls.className = "dictionary-popup__toolbar";

  const backButton = createButton(
    "Back",
    "dictionary-popup__action",
    () => {
      popupState.view = "definition";
      popupState.status = "";
      renderPopup();
    }
  );

  const exportButton = createButton(
    "Export .txt",
    "dictionary-popup__action dictionary-popup__action--primary",
    () => {
      void exportHistory();
    }
  );

  controls.append(backButton, exportButton);

  const title = document.createElement("h3");
  title.className = "dictionary-popup__title";
  title.textContent = "History";

  card.append(controls, title);

  if (popupState.loading) {
    const loadingText = document.createElement("p");
    loadingText.className = "dictionary-popup__empty";
    loadingText.textContent = popupState.loadingMessage || "Loading...";
    card.appendChild(loadingText);
    return;
  }

  if (popupState.status) {
    const status = document.createElement("p");
    status.className = "dictionary-popup__status";
    status.textContent = popupState.status;
    card.appendChild(status);
  }

  if (!popupState.history.length) {
    const emptyText = document.createElement("p");
    emptyText.className = "dictionary-popup__empty";
    emptyText.textContent = "No saved words yet.";
    card.appendChild(emptyText);
    return;
  }

  const list = document.createElement("div");
  list.className = "dictionary-popup__history-list";

  for (const word of popupState.history) {
    const item = createButton(
      word,
      "dictionary-popup__history-item",
      () => {
        void showDefinitionFromHistory(word);
      }
    );
    list.appendChild(item);
  }

  card.appendChild(list);
}

async function sendBackgroundMessage(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) {
    throw new Error(response?.error || "Request failed.");
  }

  return response;
}

async function showHistory() {
  popupState.view = "history";
  popupState.loading = true;
  popupState.loadingMessage = "Loading history...";
  popupState.status = "";
  renderPopup();

  try {
    const response = await sendBackgroundMessage({
      action: "getHistory"
    });
    popupState.history = response.words;
  } catch (error) {
    popupState.history = [];
    popupState.status = error.message;
  } finally {
    popupState.loading = false;
    popupState.loadingMessage = "";
    renderPopup();
  }
}

async function showDefinitionFromHistory(word) {
  popupState.loading = true;
  popupState.loadingMessage = "Loading definition...";
  popupState.status = "";
  renderPopup();

  try {
    const response = await sendBackgroundMessage({
      action: "getDefinition",
      word
    });
    popupState.view = "definition";
    popupState.word = response.word;
    popupState.definition = response.definition;
  } catch (error) {
    popupState.loading = false;
    popupState.loadingMessage = "";
    popupState.status = error.message;
    renderPopup();
    return;
  }

  popupState.loading = false;
  popupState.loadingMessage = "";
  renderPopup();
}

async function exportHistory() {
  popupState.status = "";
  renderPopup();

  try {
    await sendBackgroundMessage({
      action: "exportHistory"
    });
    popupState.status = "History exported.";
  } catch (error) {
    popupState.status = error.message;
  }

  renderPopup();
}
