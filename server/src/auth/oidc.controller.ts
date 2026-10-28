// Единый вход: GET start → провайдер → GET callback → refresh-cookie → SPA восстанавливает сессию.
// Ошибки возвращают на /login?sso=<код> — без подробностей, которые помогли бы подобрать вход.
import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from './guards';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { setRefreshCookie } from './auth.controller';
import { authorizationUrl, discovery, exchangeCode, loginFromClaims, newState, oidcConfig, type OidcState } from './oidc';

const STATE_COOKIE = 'vp_oidc';
const STATE_PATH = '/api/v1/auth/oidc';

@ApiTags('auth')
@Controller('api/v1/auth/oidc')
@Public()
export class OidcController {
  private readonly log = new Logger('OIDC');

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Get('config')
  @ApiOperation({ operationId: 'getSsoConfig', summary: 'Единый вход: включён ли, подпись кнопки, разрешён ли вход по паролю' })
  config() {
    const cfg = oidcConfig();
    return { enabled: cfg.enabled, label: cfg.label, localLogin: !cfg.enabled || cfg.localLogin };
  }

  @Get('start')
  @ApiOperation({ operationId: 'startSso', summary: 'Начать вход через провайдер (302 на страницу входа провайдера)' })
  async start(@Res() res: Response) {
    const cfg = oidcConfig();
    if (!cfg.enabled) return res.redirect(302, `${cfg.appUrl}/login?sso=disabled`);
    try {
      const d = await discovery(cfg);
      const s = newState();
      res.cookie(STATE_COOKIE, this.tokens.signTransient(s), {
        // lax: cookie нужна при возврате с сайта провайдера (межсайтовая навигация верхнего уровня)
        httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: STATE_PATH, maxAge: 10 * 60 * 1000,
      });
      return res.redirect(302, authorizationUrl(cfg, d, s));
    } catch (e) {
      this.log.error(`Провайдер недоступен: ${(e as Error).message}`);
      return res.redirect(302, `${cfg.appUrl}/login?sso=unavailable`);
    }
  }

  @Get('callback')
  @ApiOperation({ operationId: 'ssoCallback', summary: 'Возврат от провайдера: проверка, выдача сессии, 302 в приложение' })
  async callback(
    @Req() req: Request,
      @Res() res: Response,
      @Query('code') code?: string,
      @Query('state') state?: string,
      @Query('error') providerError?: string,
  ) {
    const cfg = oidcConfig();
    const fail = (reason: string) => {
      res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
      return res.redirect(302, `${cfg.appUrl}/login?sso=${reason}`);
    };
    if (!cfg.enabled) return fail('disabled');
    if (providerError) return fail('cancelled');
    const saved = this.tokens.verifyTransient<OidcState>((req.cookies?.[STATE_COOKIE] as string) ?? '');
    if (!saved || !code || !state || state !== saved.state) return fail('expired');
    let login: string | null;
    try {
      login = loginFromClaims(await exchangeCode(cfg, code, saved), cfg.loginClaim);
    } catch (e) {
      this.log.warn(`Проверка ответа провайдера не прошла: ${(e as Error).message}`);
      return fail('invalid');
    }
    const result = login ? await this.auth.loginByLogin(login) : null;
    if (!result) {
      this.log.warn(`Вход через провайдер: сотрудник «${login ?? '—'}» не найден или уволен`);
      return fail('unknown');
    }
    res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
    setRefreshCookie(res, result.refreshToken, result.expiresAt);
    return res.redirect(302, `${cfg.appUrl}/schedule`);
  }
}
