export function composeCapture(canvas, report, title) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const c = out.getContext('2d');
  c.drawImage(canvas, 0, 0);
  const s = out.width / 1280;
  c.scale(s, s);
  const h = out.height / s;

  c.fillStyle = 'rgba(249,244,233,.94)';
  c.fillRect(18, 14, 310, 43);
  c.fillStyle = '#254D3A';
  c.font = '600 12px system-ui';
  c.fillText('AN PHIM / ART REVIEW D / HQ GARDENS', 28, 32);
  c.font = '10px system-ui';
  c.fillText(title, 28, 47);

  if (report.massingReview) {
    c.fillStyle = 'rgba(180, 83, 9, 0.94)';
    c.fillRect(18, h - 85, 420, 50);
    c.fillStyle = '#FFFFFF';
    c.font = 'bold 14px system-ui';
    c.fillText('MASSING-ONLY ARCHITECTURAL REVIEW', 32, h - 55);
    c.font = '11px system-ui';
    c.fillText('Decorative vegetation & lines hidden · Spatial geometry only', 32, h - 40);
  } else if (report.mode !== 'world') {
    c.fillStyle = 'rgba(249,244,233,.94)';
    c.fillRect(18, h - 126, 700, 107);
    c.fillStyle = '#254D3A';
    c.font = 'bold 14px system-ui';
    c.fillText(
      report.mode === 'system'
        ? 'MOCK / UNVERIFIED DEPENDENCIES — NOT ONLINE STATUS'
        : 'TARGET / DEMO RELATIONS — NOT LIVE TELEMETRY',
      32,
      h - 99
    );
    c.font = '12px system-ui';
    c.fillText('No production connection · selected entities outlined · maximum 6 links', 32, h - 77);
    c.fillText(
      report.mode === 'system'
        ? 'Dashed: proposed data / infrastructure dependencies'
        : 'Documents · Finance · Agent execution · Reporting / Data',
      32,
      h - 55
    );
    const lines = [...document.querySelectorAll('#relation-list li')].map(e => e.textContent);
    c.fillStyle = 'rgba(249,244,233,.94)';
    c.fillRect(755, h - 185, 505, 166);
    c.fillStyle = '#254D3A';
    c.font = '11px system-ui';
    lines.slice(0, 6).forEach((text, i) => c.fillText(text, 768, h - 160 + i * 23, 478));
  }

  c.fillStyle = 'rgba(37,77,58,.9)';
  c.font = '11px system-ui';
  c.fillText('Actual Three.js render · Visual proof · Art approval pending', 20, h - 8);
  return out.toDataURL('image/png');
}