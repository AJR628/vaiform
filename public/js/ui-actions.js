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
    if (typeof window.saveQuote === 'function') {
      window.saveQuote();
    } else {
      console.error('[ui-actions] saveQuote function not found');
    }
  },
  
  cancelEdit: () => {
    console.log('[ui-actions] cancelEdit triggered');
    if (typeof window.cancelEdit === 'function') {
      window.cancelEdit();
    } else {
      console.error('[ui-actions] cancelEdit function not found');
    }
  },
  
  editQuote: () => {
    console.log('[ui-actions] editQuote triggered');
    if (typeof window.editQuote === 'function') {
      window.editQuote();
    } else {
      console.error('[ui-actions] editQuote function not found');
    }
  },
  
  // Media actions
  setMediaTab: (event) => {
    // SSOT: read from data-type (matches getActiveAssetType() and DOM)
    const kind = event.target.dataset.type;
    console.log('[ui-actions] setMediaTab triggered for type:', kind);
    
    // Update current asset type
    if (typeof window !== 'undefined') {
      window.currentAssetType = kind;
    }
    
    // Update tab styles
    const tabs = document.querySelectorAll('[data-type]');
    tabs.forEach(tab => {
      if (tab.dataset.type === kind) {
        // Active tab
        tab.classList.remove('bg-gray-600', 'dark:bg-gray-700');
        tab.classList.add('bg-blue-600');
      } else {
        // Inactive tab
        tab.classList.remove('bg-blue-600');
        tab.classList.add('bg-gray-600', 'dark:bg-gray-700');
      }
    });
    
    // Clear grid when switching tabs (user must click Search to load new assets)
    const grid = document.getElementById('asset-grid');
    if (grid) {
      grid.innerHTML = '';
    }
    
    // Do NOT auto-search; user must click Search button
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
