import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { getSession } from './api';
import { MockPadHost } from './pad/MockPadHost';
import { DocumentPage } from './pages/DocumentPage';
import { LoginPage } from './pages/LoginPage';
import { UploadPage } from './pages/UploadPage';

type SessionState = 'checking' | 'authenticated' | 'anonymous' | 'error';

function SessionGate() {
  const [state, setState] = useState<SessionState>('checking');

  useEffect(() => {
    let active = true;
    getSession()
      .then(({ authenticated }) => {
        if (active) setState(authenticated ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => { active = false; };
  }, []);

  if (state === 'checking') return <p role="status">Проверяем сеанс…</p>;
  if (state === 'error') return <p role="alert">Не удалось проверить сеанс.</p>;
  if (state === 'anonymous') return <Navigate to="/login" replace />;
  return <Outlet />;
}

function ProtectedRoutes() {
  const { pathname } = useLocation();
  return <SessionGate key={pathname} />;
}

export function App() {
  return (
    <BrowserRouter>
      <main className="app-shell">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoutes />}>
            <Route index element={<UploadPage />} />
            <Route path="/doc/:id" element={<DocumentPage />} />
            <Route path="*" element={<h1>Страница не найдена</h1>} />
          </Route>
        </Routes>
      </main>
      <MockPadHost />
    </BrowserRouter>
  );
}
