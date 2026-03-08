function initWindowUI(options = {}) {
  const body = document.body;
  if (!body) {
    return;
  }

  const windowId = options.windowId || body.dataset.windowId || document.title || 'window';
  const windowResizable = options.windowResizable ?? body.dataset.windowResizable === 'true';
  const persistTextareaSize = options.persistTextareaSize ?? true;

  if (windowResizable) {
    body.classList.add('window-resizable');
  }

  if (!persistTextareaSize) {
    return;
  }

  const textareas = Array.from(document.querySelectorAll('textarea[id]'));
  if (textareas.length === 0) {
    return;
  }

  const storageKeyFor = (textarea) => `ai-assistant:textarea-height:${windowId}:${textarea.id}`;
  const saveTimers = new Map();

  function persistHeight(textarea) {
    if (!textarea || !textarea.id) {
      return;
    }
    try {
      const height = Math.round(textarea.getBoundingClientRect().height);
      if (height > 0) {
        localStorage.setItem(storageKeyFor(textarea), String(height));
      }
    } catch (e) {}
  }

  function schedulePersist(textarea) {
    const existing = saveTimers.get(textarea.id);
    if (existing) {
      clearTimeout(existing);
    }
    const timerId = setTimeout(() => {
      saveTimers.delete(textarea.id);
      persistHeight(textarea);
    }, 120);
    saveTimers.set(textarea.id, timerId);
  }

  textareas.forEach((textarea) => {
    textarea.classList.add('ui-resizable-textarea');

    try {
      const savedHeight = Number(localStorage.getItem(storageKeyFor(textarea)) || '');
      if (savedHeight > 0) {
        textarea.style.height = `${savedHeight}px`;
      }
    } catch (e) {}

    textarea.addEventListener('mouseup', () => schedulePersist(textarea));
    textarea.addEventListener('pointerup', () => schedulePersist(textarea));
  });

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLTextAreaElement) {
          schedulePersist(entry.target);
        }
      }
    });
    textareas.forEach((textarea) => observer.observe(textarea));
  }

  window.addEventListener('beforeunload', () => {
    textareas.forEach(persistHeight);
  });
}
