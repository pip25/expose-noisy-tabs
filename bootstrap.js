Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Timer.jsm");

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const EXT_NAME = "expose-noisy-tabs";

const STATE_PLAYING = 1;
const STATE_PLAYING_MUTED = 2;
const STATE_NOT_PLAYING = 3;

const ENT_ICON_CLASS = "entIcon";
const ENT_NOISY_ATTRIBUTE = "entNoisy";

const NOISY_ICON_SRC = "chrome://" + EXT_NAME + "/content/tab_icon.png";
const NOT_NOISY_ICON_SRC = "chrome://" + EXT_NAME + "/content/tab_icon_muted.png";

const NOISY_ICON_TOOLTIPTEXT = "Mute this tab";
const NOT_NOISY_ICON_TOOLTIPTEXT = "Unmute this tab";

function findTabForDocument(document) {
    let documentWindow = document.defaultView.top;
    let windowsEnumerator = Services.wm.getEnumerator("navigator:browser");
    while (windowsEnumerator.hasMoreElements()) {
        let window = windowsEnumerator.getNext().QueryInterface(Components.interfaces.nsIDOMWindow);
        let tabBrowser = window.gBrowser;
        for (let currentTab of tabBrowser.tabs) {
            let browser = window.gBrowser.getBrowserForTab(currentTab);
            let contentWindow = browser.contentWindow;
            if (contentWindow == documentWindow) {
                return currentTab;
            }
        }
    }
    return null;
}

function hasTabIcon(tab) {
    let document = tab.ownerDocument;
    return (document.getAnonymousElementByAttribute(tab, "class", ENT_ICON_CLASS) != null);
}

function createIconForTab(tab) {
    let document = tab.ownerDocument;
    let tabLabel = document.getAnonymousElementByAttribute(tab, "class", "tab-text tab-label");
    if (tabLabel) {
        let document = tab.ownerDocument;
        let icon = document.createElementNS(XUL_NS, "xul:image");
        let normalOpacity = "0.75";
        let hoverOpacity = "1.0";
        icon.className = ENT_ICON_CLASS;
        icon.style.opacity = normalOpacity;
        icon.addEventListener("mousedown", function(event) {
            if (event.button == 0) {
                toggleMediaElementsMute(tab);
                event.stopPropagation();
            }
        }, true);
        icon.onmouseover = function() {
            icon.style.opacity = hoverOpacity;
        };
        icon.onmouseout = function() {
            icon.style.opacity = normalOpacity;
        };
        tabLabel.parentNode.insertBefore(icon, tabLabel.nextSibling);
        return true;
    }
    return false;
}

function clearIconFromTab(tab) {
    let document = tab.ownerDocument;
    let entIcon = document.getAnonymousElementByAttribute(tab, "class", ENT_ICON_CLASS);
    if (entIcon) {
        entIcon.parentNode.removeChild(entIcon);
        tab.removeAttribute(ENT_NOISY_ATTRIBUTE);
    }
}

function setIconForTab(tab, state) {
    if (hasTabIcon(tab) || createIconForTab(tab)) {
        let document = tab.ownerDocument;
        let entIcon = document.getAnonymousElementByAttribute(tab, "class", ENT_ICON_CLASS);
        if (state == STATE_PLAYING) {
            entIcon.src = NOISY_ICON_SRC;
            entIcon.setAttribute("tooltiptext", NOISY_ICON_TOOLTIPTEXT);
            tab.setAttribute(ENT_NOISY_ATTRIBUTE, true);
        } else if (state == STATE_PLAYING_MUTED) {
            entIcon.src = NOT_NOISY_ICON_SRC;
            entIcon.setAttribute("tooltiptext", NOT_NOISY_ICON_TOOLTIPTEXT);
            tab.setAttribute(ENT_NOISY_ATTRIBUTE, false);
        } else {
            tab.removeAttribute(ENT_NOISY_ATTRIBUTE);
            entIcon.src = null;
        }
    }
}

function updateStatesForDocument(states, document) {
    let mediaElements = getMediaElementsFromDocument(document);
    let hasAnyNonPausedMediaElements = false;
    let hasAnyNonMutedMediaElements = false;
    for (let mediaElement of mediaElements) {
        if (mediaElement.mozHasAudio !== false) {
            if (!mediaElement.paused && mediaElement.seeking !== true) {
                hasAnyNonPausedMediaElements = true;
                if (!mediaElement.muted) {
                    hasAnyNonMutedMediaElements = true;
                    break;
                }
            }
        }
    }
    if (hasAnyNonPausedMediaElements) {
        if (hasAnyNonMutedMediaElements) {
            states.playing = true;
        } else {
            states.playingMuted = true;
        }
    }
    let frameElements = document.getElementsByTagName("iframe");
    for (let frameElement of frameElements) {
        let frameWindow = frameElement.contentWindow;
        if (frameWindow != frameWindow.top) {
            updateStatesForDocument(states, frameWindow.document);
        }
    }
}

function updateIconForTab(tab) {
    let browser = tab.linkedBrowser;
    if (browser) {
        let document = browser.contentDocument;
        let states = {
            playing: false,
            playingMuted: false
        };
        updateStatesForDocument(states, document);
        if (states.playing) {
            setIconForTab(tab, STATE_PLAYING);
        } else if (states.playingMuted) {
            setIconForTab(tab, STATE_PLAYING_MUTED);
        } else if (hasTabIcon(tab)) {
            setIconForTab(tab, STATE_NOT_PLAYING);
        }
    }
}

function getMediaElementsFromDocument(document) {
    let mediaElements = [];
    mediaElements.push.apply(mediaElements, document.getElementsByTagName("video"));
    mediaElements.push.apply(mediaElements, document.getElementsByTagName("audio"));
    return mediaElements;
}

function toggleMuteMediaElementsInDocument(document, mute) {
    let mediaElements = getMediaElementsFromDocument(document);
    for (let mediaElement of mediaElements) {
        mediaElement.muted = mute;
    }
    let frameElements = document.getElementsByTagName("iframe");
    for (let frameElement of frameElements) {
        let frameWindow = frameElement.contentWindow;
        if (frameWindow != frameWindow.top) {
            toggleMuteMediaElementsInDocument(frameWindow.document, mute);
        }
    }
}

function toggleMediaElementsMute(tab) {
    if (tab.getAttribute(ENT_NOISY_ATTRIBUTE) != null) {
        let mute = (tab.getAttribute(ENT_NOISY_ATTRIBUTE) == "true");
        let browser = tab.linkedBrowser;
        let document = browser.contentDocument;
        toggleMuteMediaElementsInDocument(document, mute);
    }
}

function onKeyUp(event) {
    if (event.ctrlKey && event.keyCode == 77) { // ctrl + m
        let document = event.view.document;
        let tab = findTabForDocument(document);
        toggleMediaElementsMute(tab);
    }
}

function onMediaElementEvent(event) {
    let mediaElement = event.target;
    let document = mediaElement.ownerDocument;
    let tab = findTabForDocument(document);
    updateIconForTab(tab);
}

function addMediaElementEventListeners(window) {
    window.addEventListener("playing", onMediaElementEvent, true);
    window.addEventListener("volumechange", onMediaElementEvent, true);
    window.addEventListener("pause", onMediaElementEvent, true);
    window.addEventListener("emptied", onMediaElementEvent, true);
    window.addEventListener("loadeddata", onMediaElementEvent, true);
    window.addEventListener("seeking", onMediaElementEvent, true);
}

function removeMediaElementEventListeners(window) {
    window.removeEventListener("playing", onMediaElementEvent, true);
    window.removeEventListener("volumechange", onMediaElementEvent, true);
    window.removeEventListener("pause", onMediaElementEvent, true);
    window.removeEventListener("emptied", onMediaElementEvent, true);
    window.removeEventListener("loadeddata", onMediaElementEvent, true);
    window.removeEventListener("seeking", onMediaElementEvent, true);
}

function enableMediaNodeForceAttach(document) {
    let overwriteFunc = `
        (function(){
        var elementConstructor = document.createElement;
        document.createElement = function (name) {
            var el = elementConstructor.apply(document, arguments);

            if (el.tagName === "AUDIO" || el.tagName === "VIDEO") {
                window.setTimeout(function() {
                    if (!el.parentNode) {
                        document.body.appendChild(el);
                    }
                }, 500);
            }

            return el;
        };
        })();
    `;
    let scriptInject = document.createElement('script');
    scriptInject.language = "javascript";
    scriptInject.innerHTML = overwriteFunc;
    document.body.appendChild(scriptInject);
}

function mutationEventListener(tab) {
    this.onMutations = function(mutations) {
        mutations.forEach(function(mutation) {
            for (let removedNode of mutation.removedNodes) {
                if (removedNode.tagName == "VIDEO" || removedNode.tagName == "AUDIO" ||
                    removedNode.tagName == "IFRAME") {
                    updateIconForTab(tab);
                    break;
                }
            }
        });
    };
}

function plugIntoDocument(document, tab) {
    if (Components.utils.isDeadWrapper(document) || Components.utils.isDeadWrapper(tab)) {
        return false;
    }

    if (document.body && !document.entObserver) {
        let window = document.defaultView;
        if (window) {
            addMediaElementEventListeners(window);

            let documentMutationEventListener = new mutationEventListener(tab);
            document["entObserver"] = new window.MutationObserver(documentMutationEventListener.onMutations);
            document.entObserver.observe(document.body, {childList: true, subtree: true});
            addHotkeyEventListener(tab);

            enableMediaNodeForceAttach(document);
            return true;
        }
    }
    return false;
}

function unplugFromDocument(document) {
    if (document && document.body && document.entObserver) {
        let window = document.defaultView;
        if (window) {
            removeMediaElementEventListeners(window);

            document.entObserver.disconnect();
            document.entObserver = undefined;
            let tab = findTabForDocument(document);
            removeHotkeyEventListener(tab);

            let frameElements = document.getElementsByTagName("iframe");
            for (let frameElement of frameElements) {
                let frameWindow = frameElement.contentWindow;
                if (frameWindow != frameWindow.top) {
                    unplugFromDocument(frameWindow.document);
                }
            }
        }
    }
}

function addHotkeyEventListener(tab) {
    if (tab) {
        let browser = tab.linkedBrowser;
        let document = browser.contentDocument;
        document.addEventListener("keyup", onKeyUp, false);
    }
}

function removeHotkeyEventListener(tab) {
    if (tab) {
        let browser = tab.linkedBrowser;
        let document = browser.contentDocument;
        document.removeEventListener("keyup", onKeyUp, false);
    }
}

function plugIntoTab(tab) {
    let browser = tab.linkedBrowser;
    let document = browser.contentDocument;
    if (plugIntoDocument(document, tab)) {
        updateIconForTab(tab);
        addHotkeyEventListener(tab);
    }
}

function unplugFromTab(tab) {
    let browser = tab.linkedBrowser;
    let document = browser.contentDocument;
    unplugFromDocument(document);
    removeHotkeyEventListener(tab);
    clearIconFromTab(tab);
}

function onDocumentLoad(event) {
    let document = event.target;
    let tab = findTabForDocument(document);
    setTimeout(function() {
        if (plugIntoDocument(document, tab)) {
            updateIconForTab(tab);
        }
    }, 100);
}

function onPageHide(event) {
    let document = event.target;
    let tab = findTabForDocument(document);
    setTimeout(function() {
        updateIconForTab(tab);
    }, 100);
}

function onTabMove(event) {
    let tab = event.target;
    updateIconForTab(tab);
}

function fixCloseTabButton(event) {
    let tab = event.target;
    let document = tab.ownerDocument;
    let closeButton = document.getAnonymousElementByAttribute(tab, "class", "tab-close-button close-icon");
    closeButton.setAttribute("selected", tab.selected);
}

function initTabsForWindow(window) {
    let tabBrowser = window.gBrowser;
    for (let tab of tabBrowser.tabs) {
        plugIntoTab(tab);
    }
    tabBrowser.addEventListener("load", onDocumentLoad, true);
    tabBrowser.addEventListener("pagehide", onPageHide, true);
    tabBrowser.tabContainer.addEventListener("TabMove", onTabMove, false);
    tabBrowser.tabContainer.addEventListener("TabAttrModified", fixCloseTabButton, false);
}

function clearTabsForWindow(window) {
    let tabBrowser = window.gBrowser;
    for (let tab of tabBrowser.tabs) {
        unplugFromTab(tab);
    }
    tabBrowser.removeEventListener("load", onDocumentLoad, true);
    tabBrowser.removeEventListener("pagehide", onPageHide, true);
    tabBrowser.tabContainer.removeEventListener("TabMove", onTabMove, false);
    tabBrowser.tabContainer.removeEventListener("TabAttrModified", fixCloseTabButton, false);
}

let windowListener = {
    onOpenWindow: function(nsIObj) {
        let window = nsIObj.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                              .getInterface(Components.interfaces.nsIDOMWindow);
        window.addEventListener("load", function() {
            window.removeEventListener("load", arguments.callee, false);
            if (window.document.documentElement.getAttribute("windowtype") === "navigator:browser") {
                initTabsForWindow(window);
            }
        });
    },

    onCloseWindow: function(nsIObj) {
        let window = nsIObj.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                              .getInterface(Components.interfaces.nsIDOMWindow);
        if (window.document.documentElement.getAttribute("windowtype") === "navigator:browser") {
            clearTabsForWindow(window);
        }
    }
};

function initWindows() {
    let windowsEnumerator = Services.wm.getEnumerator("navigator:browser");
    while (windowsEnumerator.hasMoreElements()) {
        let window = windowsEnumerator.getNext().QueryInterface(Components.interfaces.nsIDOMWindow);
        initTabsForWindow(window);
    }
    Services.wm.addListener(windowListener);
}

function clearWindows() {
    Services.wm.removeListener(windowListener);
    let windowsEnumerator = Services.wm.getEnumerator("navigator:browser");
    while (windowsEnumerator.hasMoreElements()) {
        let window = windowsEnumerator.getNext().QueryInterface(Components.interfaces.nsIDOMWindow);
        clearTabsForWindow(window);
    }
}

function startup(data, reason) {
    initWindows();
}

function shutdown(data, reason) {
    clearWindows();
}

function install(data, reason) {}

function uninstall(data, reason) {}