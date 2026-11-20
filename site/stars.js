(() => {
  const element = document.querySelector('.github-count');
  if (!element) return;
  const format = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const refresh = async () => {
    let seconds = 60;
    try {
      const response = await fetch('/api/github-stars', { priority: 'low' });
      const { stars, refreshAfter } = await response.json();
      if (Number.isSafeInteger(refreshAfter) && refreshAfter > 0) seconds = Math.min(refreshAfter, 15 * 60);
      if (response.ok && Number.isSafeInteger(stars) && stars >= 0) element.textContent = format.format(stars).toLowerCase();
    } catch {
      // The current text is still useful when the refresh fails.
    } finally {
      setTimeout(refresh, seconds * 1000);
    }
  };
  void refresh();
})();
