const NAV_ITEMS = [
  { id: 'becca', icon: '/icons/robot.png', title: 'Homin' },
  { id: 'proposals', icon: '/icons/file-text.png', title: 'Proposals' },
  { id: 'design', icon: '/icons/pencil.png', title: 'Design' },
  { id: 'brandkit', icon: '/icons/image.png', title: 'Brand Kit' },
];

export default function NavRail({ section, onNavigate, onOpenProfile, onLogout }) {
  return (
    <nav className="nav-rail no-print">
      <div className="nav-logo" onClick={() => onNavigate('proposals')} title="Homing">
        <img src="/icons/logomark.png" alt="" className="nav-logo-img" />
      </div>
      {NAV_ITEMS.map((item) => (
        <div
          key={item.id}
          className={section === item.id ? 'nav-item active' : 'nav-item'}
          title={item.title}
          onClick={() => onNavigate(item.id)}
        >
          <img src={item.icon} alt="" className="nav-item-img" />
        </div>
      ))}
      <div className="nav-spacer" />
      <div
        className={section === 'settings' ? 'nav-item active' : 'nav-item'}
        title="Settings"
        onClick={onOpenProfile}
      >
        <img src="/icons/settings.png" alt="" className="nav-item-img" />
      </div>
      {onLogout && (
        <div className="nav-item" title="Sign out" onClick={onLogout}>
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
        </div>
      )}
    </nav>
  );
}
