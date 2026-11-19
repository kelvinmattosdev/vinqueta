// Uma entrada de credenciais, duas sessões técnicas; nunca guarda a senha.
export class SupplierAccess {
  constructor(api, portal, clearCookies) {
    this.api = api; this.portal = portal; this.clearCookies = clearCookies;
  }
  get authenticated() { return Boolean(this.api?.user && this.portal.authenticated); }
  async logout() {
    this.api?.logout(); this.portal.logout();
    await this.clearCookies();
  }
  async login(credentials) {
    await this.logout();
    const identity = await this.api.login(credentials);
    try { await this.portal.login(credentials); }
    catch {
      await this.logout();
      throw new Error('Não foi possível confirmar o acesso ao portal da Havan. Verifique se há alguma etapa pendente no portal e tente entrar novamente.');
    }
    return identity;
  }
  requireSession() {
    if (!this.authenticated) throw new Error('Sua sessão não está ativa. Faça login novamente.');
  }
}
