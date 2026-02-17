/**
 * UI Actions Handler - Delegated Event System
 * Provides resilient event handling for all action buttons using data-action attributes
 */

// Action handlers map - maps data-action values to controller functions (Article-only after Quote Studio removal)
const ACTIONS = {
  summarizeArticle: () => {
    console.log('[ui-actions] summarizeArticle triggered');
    if (typeof window.summarizeArticle === 'function') {
      window.summarizeArticle();
    } else {
      console.error('[ui-actions] summarizeArticle function not found');
    }
  },

  prepareStoryboard: () => {
    console.log('[ui-actions] prepareStoryboard triggered');
    if (typeof window.prepareStoryboard === 'function') {
      window.prepareStoryboard();
    } else {
      console.error('[ui-actions] prepareStoryboard function not found');
    }
  },

  renderArticle: () => {
    console.log('[ui-actions] renderArticle triggered');
    if (typeof window.renderArticle === 'function') {
      window.renderArticle();
    } else {
      console.error('[ui-actions] renderArticle function not found');
    }
  },
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
