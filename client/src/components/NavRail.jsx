const NAV_ITEMS = [
  { id: 'becca', icon: '🤖', title: 'Homin' },
  { id: 'proposals', icon: '📄', title: 'Proposals' },
];

export default function NavRail({ section, onNavigate, theme, onToggleTheme, onOpenProfile }) {
  return (
    <nav className="nav-rail no-print">
      <div className="nav-logo" onClick={() => onNavigate('proposals')} title="Homing">
        ✦
      </div>
      {NAV_ITEMS.map((item) => (
        <div
          key={item.id}
          className={section === item.id ? 'nav-item active' : 'nav-item'}
          title={item.title}
          onClick={() => onNavigate(item.id)}
        >
          {item.icon}
        </div>
      ))}
      <div className="nav-spacer" />
      <div
        className={section === 'settings' ? 'nav-item active' : 'nav-item'}
        title="Settings"
        onClick={onOpenProfile}
      >
        ⚙️
      </div>
      <button
        type="button"
        className="theme-toggle"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        onClick={onToggleTheme}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
    </nav>
  );
}
