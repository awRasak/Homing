export default function ComingSoon({ icon, title, description }) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-icon">{icon}</div>
      <div className="coming-soon-title">{title}</div>
      <div className="coming-soon-desc">{description}</div>
    </div>
  );
}
