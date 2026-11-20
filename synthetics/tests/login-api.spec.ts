import { test, expect } from '@playwright/test';

// Usuário dedicado ao sintético: papel "synthetic", sem acesso administrativo.
const USER = process.env.SYNTH_USER ?? '';
const PASS = process.env.SYNTH_PASSWORD ?? '';

test('login-api', async ({ request }) => {
  let token = '';

  await test.step('login', async () => {
    const res = await request.post('/auth/login', {
      data: { username: USER, password: PASS },
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json();
    expect(body.token_type).toBe('Bearer');
    expect(body.access_token).toBeTruthy();
    token = body.access_token;
  });

  await test.step('perfil', async () => {
    const res = await request.get('/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status(), await res.text()).toBe(200);

    const me = await res.json();
    expect(me.username).toBe(USER);
    expect(me.role).toBe('synthetic');
  });

  // Garante que o usuário do sintético continua sem privilégios.
  // Se alguém der papel de admin a ele por engano, a jornada falha.
  await test.step('sem-privilegios', async () => {
    const res = await request.get('/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);
  });
});
