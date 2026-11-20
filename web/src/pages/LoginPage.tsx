import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiClientError, login } from '../api';

export function LoginPage() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setPending(true);
    setError(undefined);
    try {
      await login({ password });
      await navigate('/', { replace: true });
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 401) {
        setError('Неверный пароль');
      } else if (cause instanceof ApiClientError && cause.status === 429) {
        setError('Слишком много попыток, подождите минуту');
      } else {
        setError(cause instanceof ApiClientError ? cause.message : 'Не удалось войти. Попробуйте ещё раз.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="login-page">
      <h1>Вход</h1>
      <form className="login-form" onSubmit={submit}>
        <label htmlFor="login-password">Пароль</label>
        <input id="login-password" name="password" type="password" autoComplete="current-password" required />
        {error && <p role="alert">{error}</p>}
        <button className="esign-button esign-button--primary" type="submit" disabled={pending}>
          {pending ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </section>
  );
}
