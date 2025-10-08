/**
 * UI Actions Handler - Delegated Event System
 * Provides resilient event handling for all action buttons using data-action attributes
 */

// Action handlers map - maps data-action values to controller functions
const ACTIONS = {
  // Quote actions
  generateQuote: () => {
    console.log('[ui-actions] generateQuote triggered');
    if (typeof window.generateQuote === 'function') {
      window.generateQuote();
    } else {
      console.error('[ui-actions] generateQuote function not found');
    }
  },
  
  rephraseQuote: () => {
    console.log('[ui-actions] rephraseQuote triggered');
    if (typeof window.remixQuote === 'function') {
      window.remixQuote('rephrase');
    } else {
      console.error('[ui-actions] remixQuote function not found');
    }
  },
  
  regenerateQuote: () => {
    console.log('[ui-actions] regenerateQuote triggered');
    if (typeof window.remixQuote === 'function') {
      window.remixQuote('regenerate');
    } else {
      console.error('[ui-actions] remixQuote function not found');
    }
  },
  
  changeTone: () => {
    console.log('[ui-actions] changeTone triggered');
    if (typeof window.remixQuote === 'function') {
      window.remixQuote('tone_shift');
    } else {
      console.error('[ui-actions] remixQuote function not found');
    }
  },
  
  saveQuote: () => {
    console.log('[ui-actions] saveQuote triggered');
    const saveBtn = document.getElementById('save-quote-btn');
    if (saveBtn && typeof saveBtn.onclick === 'function') {
      saveBtn.onclick();
    } else {
      console.error('[ui-actions] saveQuote handler not found');
    }
  },
  
  cancelEdit: () => {
    console.log('[ui-actions] cancelEdit triggered');
    const cancelBtn = document.getElementById('cancel-quote-btn');
    if (cancelBtn && typeof cancelBtn.onclick === 'function') {
      cancelBtn.onclick();
    } else {
      console.error('[ui-actions] cancelEdit handler not found');
    }
  },
  
  editQuote: () => {
    console.log('[ui-actions] editQuote triggered');
    const editBtn = document.getElementById('edit-quote-btn');
    if (editBtn && typeof editBtn.onclick === 'function') {
      editBtn.onclick();
    } else {
      console.error('[ui-actions] editQuote handler not found');
    }
  },
  
  // Media actions
  setMediaTab: (event) => {
    const kind = event.target.dataset.kind;
    console.log('[ui-actions] setMediaTab triggered for kind:', kind);
    
    // Update current asset type
    if (typeof window !== 'undefined') {
      window.currentAssetType = kind;
    }
    
    // Update tab styles
    const tabs = document.querySelectorAll('[data-type]');
    tabs.forEach(tab => {
      if (tab.dataset.type === kind) {
        tab.className = tab.className.replace(/bg-gray-\d+|bg-blue-\d+/, 'bg-blue-600');
      } else {
        tab.className = tab.className.replace(/bg-gray-\d+|bg-blue-\d+/, 'bg-gray-600 dark:bg-gray-700');
      }
    });
    
    // Load assets for the selected type
    if (typeof window.loadAssets === 'function') {
      window.loadAssets(1);
    } else {
      console.error('[ui-actions] loadAssets function not found');
    }
  },
  
  searchAssets: () => {
    console.log('[ui-actions] searchAssets triggered');
    if (typeof window.loadAssets === 'function') {
      // Clear cache on new search
      if (typeof window.assetCache !== 'undefined' && window.assetCache.clear) {
        window.assetCache.clear();
      }
      window.loadAssets(1);
    } else {
      console.error('[ui-actions] loadAssets function not found');
    }
  }
};

/**
 * Initialize the delegated event system
 * Sets up a single click handler on document that routes to appropriate actions
 */
function initUIActions() {
  console.log('[ui-actions] Initializing delegated event system');
  
  // Remove any existing delegated handler to prevent duplicates
  document.removeEventListener('click', handleDelegatedClick, true);
  
  // Add the delegated click handler in capture phase
  document.addEventListener('click', handleDelegatedClick, true);
  
  console.log('[ui-actions] Delegated event system initialized');
}

/**
 * Handle delegated click events
 * Routes clicks on elements with data-action to appropriate handlers
 */
function handleDelegatedClick(event) {
  const target = event.target;
  
  // Check if the clicked element or its parent has a data-action attribute
  let actionElement = target;
  let action = null;
  
  // Walk up the DOM tree to find the action element
  while (actionElement && actionElement !== document) {
    if (actionElement.dataset && actionElement.dataset.action) {
      action = actionElement.dataset.action;
      break;
    }
    actionElement = actionElement.parentElement;
  }
  
  if (!action) {
    return; // No action to handle
  }
  
  // Prevent default behavior for action buttons
  event.preventDefault();
  event.stopPropagation();
  
  console.log('[ui-actions] Action triggered:', action, 'from element:', target);
  
  // Route to the appropriate handler
  if (ACTIONS[action]) {
    try {
      ACTIONS[action](event);
    } catch (error) {
      console.error('[ui-actions] Error executing action:', action, error);
    }
  } else {
    console.warn('[ui-actions] Unknown action:', action);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUIActions);
} else {
  initUIActions();
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initUIActions, ACTIONS, handleDelegatedClick };
}
