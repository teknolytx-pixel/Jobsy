export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="top">
        <a href="/" className="logo">
          <span className="spark">🔥</span>
          <b>Jobsy</b>
        </a>
      </header>
      <article
        style={{
          padding: "8px 16px 48px",
          lineHeight: 1.65,
          fontSize: 15,
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        {children}
      </article>
    </div>
  );
}
