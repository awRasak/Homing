import { useState, useEffect } from 'react';

export default function IosInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = localStorage.getItem('pwa:iosPromptDismissed');
    if (!isIos || isStandalone || dismissed) return;

    // Show after engagement: 12s or after 2nd visit
    const visits = parseInt(localStorage.getItem('pwa:visits') || '0', 10) + 1;
    localStorage.setItem('pwa:visits', String(visits));

    const shouldShow = visits >= 2;
    const timer = setTimeout(() => {
      if (shouldShow) setVisible(true);
      else {
        // first visit: wait for second visit, but still allow manual trigger via ?pwaPrompt=1
        if (new URLSearchParams(window.location.search).get('pwaPrompt') === '1') setVisible(true);
      }
    }, shouldShow ? 8000 : 15000);

    // Also show on second visit immediately after delay
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  function dismiss(permanent) {
    if (permanent) localStorage.setItem('pwa:iosPromptDismissed', '1');
    setVisible(false);
  }

  return (
    <div className="ios-prompt-overlay" onClick={() => dismiss(false)}>
      <div className="ios-prompt-card" onClick={(e) => e.stopPropagation()}>
        <button className="ios-prompt-close" onClick={() => dismiss(true)} aria-label="Close">×</button>
        <div className="ios-prompt-header">
          <img src="/icons/logomark.png" alt="" className="ios-prompt-icon" />
          <div>
            <div className="ios-prompt-title">Add Homing to Home Screen</div>
            <div className="ios-prompt-sub">2 taps — works offline, opens like an app</div>
          </div>
        </div>
        <div className="ios-prompt-steps">
          <div className="ios-prompt-step">
            <span className="ios-prompt-num">1</span>
            <span>Tap <span className="ios-prompt-share">⎙ Share</span> at the bottom of Safari</span>
          </div>
          <div className="ios-prompt-arrow">↓</div>
          <div className="ios-prompt-step">
            <span className="ios-prompt-num">2</span>
            <span>Tap <strong>Add to Home Screen</strong></span>
          </div>
        </div>
        <div className="ios-prompt-visual">
          <span className="ios-prompt-visual-box">Share</span>
          <span className="ios-prompt-visual-arrow">→</span>
          <span className="ios-prompt-visual-box">Add to Home Screen</span>
        </div>
        <button className="ios-prompt-cta" onClick={() => dismiss(false)}>Got it</button>
        <button className="ios-prompt-dismiss" onClick={() => dismiss(true)}>Don't show again</button>
      </div>
      <div className="ios-prompt-point" aria-hidden>▲</div>
    </div>
  );
}
