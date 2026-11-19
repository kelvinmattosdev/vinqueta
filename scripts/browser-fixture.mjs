// Usado só nas verificações de layout no navegador, sem rede ou conta Havan.
export async function installBrowserFixture(page) {
  await page.addInitScript(() => {
    let authenticated = false;
    const ok = data => ({ ok: true, data });
    window.vinqueta = {
      status: async () => ok({ protocol: true, storage: '', authenticated }),
      login: async () => {
        authenticated = true;
        return ok({ identity: { name: 'Fornecedor de teste', document: '123' } });
      },
      autoLogin: async () => ok(null),
      checkUpdates: async () => ok({ current: '0.6.1', latest: null, status: 'current', changelog: null }),
      orders: async () => ok({ orders: [], inconclusive: false }),
      history: async () => ok([]),
      onConfirmation: () => () => {},
    };
  });
}

export async function loginBrowserFixture(page) {
  const button = page.getByRole('button', { name: 'Entrar na Havan' });
  if (!await button.isVisible()) return;
  await page.getByLabel('CNPJ do fornecedor').fill('123');
  await page.getByLabel('Senha', { exact: true }).fill('senha-sintetica');
  await button.click();
  await page.getByRole('navigation', { name: 'Navegação principal' }).waitFor();
}
