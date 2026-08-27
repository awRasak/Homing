const NAV_ITEMS = [
  { id: 'becca', icon: '/icons/robot.png', title: 'Homin' },
  { id: 'proposals', icon: '/icons/file-text.png', title: 'Proposals' },
  { id: 'design', icon: '/icons/pencil.png', title: 'Design' },
  { id: 'brandkit', icon: '/icons/image.png', title: 'Brand Kit' },
  { id: 'autopilot', icon: '/icons/publish.png', title: 'Autopilot' },
];

export default function NavRail({ section, onNavigate, onOpenProfile, onLogout }) {
  return (
    <nav className="nav-rail no-print">
      <button type="button" className="nav-logo" onClick={() => onNavigate('proposals')} aria-label="Homing" title="Homing">
        <img src="/icons/logomark.png" alt="" className="nav-logo-img" />
      </button>
      {NAV_ITEMS.map((item) => (
        <button
          type="button"
          key={item.id}
          className={section === item.id ? 'nav-item active' : 'nav-item'}
          title={item.title}
          aria-label={item.title}
          aria-current={section === item.id ? 'page' : undefined}
          onClick={() => onNavigate(item.id)}
        >
          <img src={item.icon} alt="" className="nav-item-img" />
        </button>
      ))}
      <div className="nav-spacer" />
      <button
        type="button"
        className={section === 'settings' ? 'nav-item active' : 'nav-item'}
        title="Settings"
        aria-label="Settings"
        aria-current={section === 'settings' ? 'page' : undefined}
        onClick={onOpenProfile}
      >
        <img src="/icons/settings.png" alt="" className="nav-item-img" />
      </button>
      {onLogout && (
        <button type="button" className="nav-item" title="Sign out" aria-label="Sign out" onClick={onLogout}>
          <svg
            className="nav-item-img"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      )}
    </nav>
  );
}
