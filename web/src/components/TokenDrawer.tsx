import { useEffect, useState } from 'react';
import { TOKEN_KEY } from '../lib/auth';
import { api } from '../lib/api';

export function TokenDrawer() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [tt, setTt] = useState<any>(null);
  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY) || '');
  }, []);
  function save() {
    localStorage.setItem(TOKEN_KEY, token);
    setOpen(false);
  }
  async function check() {
    const r = await api.diagTtsState();
    setTt(r.ok ? r.data : null);
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-sm px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
      >
        ⚙
      </button>
      {open && (
        <div className="absolute right-0 top-8 w-[360px] bg-neutral-900 border border-neutral-800 rounded p-3 space-y-2">
          <div className="text-sm">API Base</div>
          <div className="text-xs text-neutral-400">
            {(import.meta as any).env?.VITE_API_BASE || '(via ?api=)'}
          </div>
          <div className="text-sm">Bearer token</div>
          <textarea
            className="w-full h-28 bg-neutral-950 border border-neutral-800 rounded p-2 text-xs"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="eyJhbGciOi..."
          />
          <div className="flex items-center gap-2">
            <button onClick={save} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500">
              Save
            </button>
            <button
              onClick={check}
              className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
            >
              Check TTS
            </button>
            {tt && (
              <span
                className={`text-xs px-2 py-0.5 rounded ${tt.configured ? 'bg-green-700' : 'bg-neutral-700'}`}
              >
                {tt.provider}:{tt.configured ? 'on' : 'off'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
