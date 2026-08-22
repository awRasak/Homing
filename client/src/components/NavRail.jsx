const NAV_ITEMS = [
  { id: 'becca', icon: '/icons/robot.png', title: 'Homin' },
  { id: 'proposals', icon: '/icons/file-text.png', title: 'Proposals' },
  { id: 'design', icon: '/icons/pencil.png', title: 'Design' },
];

export default function NavRail({ section, onNavigate, onOpenProfile }) {
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
    </nav>
  );
}
