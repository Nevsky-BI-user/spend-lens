// Центрована iOS-картка входу для режиму Supabase:
// Google OAuth + фолбек email-OTP (код на пошту).

import React, { useState } from 'react';

export default function LoginCard({ onGoogle, onSendOtp, onVerifyOtp }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState('idle'); // idle | sent | busy
  const [error, setError] = useState('');

  const sendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setStage('busy');
    try {
      await onSendOtp(email.trim());
      setStage('sent');
    } catch (err) {
      setError(err.message || 'Не вдалося надіслати код.');
      setStage('idle');
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    setStage('busy');
    try {
      await onVerifyOtp(email.trim(), code.trim());
    } catch (err) {
      setError(err.message || 'Неправильний код.');
      setStage('sent');
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>spend-lens</h1>
        <p className="login-sub">Аналітика витрат Claude Code. Увійдіть, щоб побачити дані.</p>

        <button type="button" className="btn-primary" onClick={onGoogle}>
          Увійти через Google
        </button>

        <div className="login-divider"><span>або код на пошту</span></div>

        {stage !== 'sent' ? (
          <form onSubmit={sendOtp} className="login-form">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="btn-secondary" disabled={stage === 'busy'}>
              {stage === 'busy' ? 'Надсилаю…' : 'Надіслати код'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="login-form">
            <p className="muted-text">Код надіслано на {email}.</p>
            <input
              type="text"
              inputMode="numeric"
              required
              placeholder="Код із листа"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit" className="btn-secondary" disabled={stage === 'busy'}>
              {stage === 'busy' ? 'Перевіряю…' : 'Підтвердити код'}
            </button>
          </form>
        )}

        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  );
}
