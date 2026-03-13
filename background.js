const MENU_ID = "defineWord";
const NOT_FOUND_MESSAGE = "Definition not found in dictionary.";
const MAX_DEFINITIONS = 2;
const HISTORY_KEY = "searchHistory";
const HISTORY_LIMIT = 500;

let dictionaryCache = null;
let dictionaryPromise = null;

function normalizeWord(word) {
  return word.toLowerCase().trim();
}

function isMissingReceiverError(error) {
  return error?.message?.includes("Receiving end does not exist");
}

function splitDefinitionEntry(entry) {
  if (/\b1\.\s/.test(entry)) {
    return entry
      .split(/\s*(?=\d+\.\s)/)
      .filter((part) => /^\d+\.\s/.test(part));
  }

  return entry.split(/\n{2,}/);
}

function cleanDefinitionPart(part) {
  return part
    .replace(/^\d+\.\s*/, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/(?:^|\s)(?:Syn\. --|Note:).*/i, "")
    .replace(/\s+["“].*$/, "")
    .replace(/["“][^"”]*["”]/g, "")
    .replace(/\s*(?:;|,)?\s*--\s*[^.;:!?]*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function takeFirstSentence(part) {
  const firstSentence = part.split(/(?<=[.!?])\s+(?=[A-Z(])/)[0] || part;
  return firstSentence.trim();
}

function finalizeDefinitionPart(part) {
  if (!part) {
    return "";
  }

  return /[.!?]$/.test(part) ? part : `${part}.`;
}

function normalizeDefinition(entry) {
  if (Array.isArray(entry)) {
    return entry.slice(0, MAX_DEFINITIONS).join(" ");
  }

  if (typeof entry !== "string") {
    return "";
  }

  const definitions = splitDefinitionEntry(entry)
    .map(cleanDefinitionPart)
    .map(takeFirstSentence)
    .map(finalizeDefinitionPart)
    .filter(Boolean)
    .slice(0, MAX_DEFINITIONS);

  return definitions.join(" ");
}

async function getHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
}

async function saveWordToHistory(word) {
  const history = await getHistory();
  const nextHistory = [word, ...history.filter((item) => item !== word)].slice(
    0,
    HISTORY_LIMIT
  );

  await chrome.storage.local.set({
    [HISTORY_KEY]: nextHistory
  });
}

async function exportHistoryAsText() {
  const history = await getHistory();
  if (!history.length) {
    throw new Error("No history to export.");
  }

  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(
    history.join("\n")
  )}`;

  await chrome.downloads.download({
    url,
    filename: "dictionary-history.txt",
    saveAs: true
  });
}

async function getDictionary() {
  if (dictionaryCache) {
    return dictionaryCache;
  }

  if (!dictionaryPromise) {
    dictionaryPromise = fetch(chrome.runtime.getURL("dictionary.json"))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load dictionary: ${response.status}`);
        }

        return response.json();
      })
      .then((data) => {
        dictionaryCache = data;
        return data;
      })
      .catch((error) => {
        dictionaryPromise = null;
        throw error;
      });
  }

  return dictionaryPromise;
}

async function lookupWord(word) {
  const dictionary = await getDictionary();
  const entry = dictionary[word];

  if (typeof entry === "undefined") {
    return null;
  }

  const definition = normalizeDefinition(entry);
  return definition || null;
}

async function ensureContentScript(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["style.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function sendDefinitionToTab(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, payload);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleRuntimeMessage(request)
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.error("Runtime message failed.", error);
      sendResponse({
        ok: false,
        error: error.message || "Unknown error."
      });
    });

  return true;
});

async function handleRuntimeMessage(request) {
  switch (request?.action) {
    case "getHistory":
      return {
        ok: true,
        words: await getHistory()
      };
    case "getDefinition": {
      const word = normalizeWord(request.word || "");
      if (!word) {
        return {
          ok: false,
          error: "No word provided."
        };
      }

      const definition = await lookupWord(word);
      if (!definition) {
        return {
          ok: false,
          error: NOT_FOUND_MESSAGE
        };
      }

      return {
        ok: true,
        word,
        definition
      };
    }
    case "exportHistory":
      await exportHistoryAsText();
      return {
        ok: true
      };
    default:
      return {
        ok: false,
        error: "Unsupported action."
      };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Define",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) {
    return;
  }

  const selectedWord = normalizeWord(info.selectionText || "");
  if (!selectedWord) {
    return;
  }

  let definition = NOT_FOUND_MESSAGE;

  try {
    const resolvedDefinition = await lookupWord(selectedWord);
    if (resolvedDefinition) {
      definition = resolvedDefinition;
      await saveWordToHistory(selectedWord);
    }
  } catch (error) {
    definition = "Dictionary could not be loaded.";
    console.error(error);
  }

  try {
    await sendDefinitionToTab(tab.id, {
      action: "showDefinition",
      word: selectedWord,
      definition
    });
  } catch (error) {
    console.error("Could not show dictionary popup in this tab.", error);
  }
});

// Warm the cache when the service worker starts.
getDictionary().catch(() => {});
