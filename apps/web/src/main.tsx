import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/rubik/cyrillic-400.css';
import '@fontsource/rubik/cyrillic-700.css';
import '../../../design-system/tokens.css';
import './style.css';

function App() {
  const [status, setStatus] = useState('');
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    setStatus('Проверяем соединение…');
    try {
      const response = await fetch('/readyz', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      setStatus(response.ok && body.status === 'ready' ? 'Тестовая среда готова.' : 'Среда временно недоступна. Попробуйте позже.');
    } catch { setStatus('Не удалось связаться с тестовой средой. Попробуйте ещё раз.'); }
    finally { setChecking(false); }
  }
  return <main>
    <header><span className="brand">JUDO PRIDE</span><span>JudeOS</span></header>
    <section>
      <p className="eyebrow">Тестовая среда</p>
      <h1>Основа для работы клуба</h1>
      <p>Здесь начинается система для сотрудников Judo Pride. Вход и журнал появятся на следующих этапах.</p>
      <p className="note">Среда использует только синтетические данные.</p>
      <button disabled={checking} onClick={check}>{checking ? 'Проверяем…' : 'Проверить готовность'}</button>
      <p role="status" aria-live="polite" className="status">{status}</p>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
