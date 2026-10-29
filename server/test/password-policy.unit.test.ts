import { describe, expect, it } from 'vitest';
import { weakPasswordReason } from '../src/auth/password-policy';
import { describeAgent } from '../src/auth/client-info';

const policy = { minLength: 10, login: 'yurasov.av', name: 'Юрасов Александр Валерьевич' };

describe('политика паролей', () => {
  it('длина — из правил организации', () => {
    expect(weakPasswordReason('Kq7-river', policy)).toMatch(/не короче 10/);
    expect(weakPasswordReason('Kq7-river-stone', policy)).toBeNull();
  });

  it('распространённые пароли — и с цифрами и знаками по краям, и в русской раскладке', () => {
    for (const p of ['qwerty123456', 'Password123!', '123456789012', 'йцукенгшщзхъ', 'Qwerty12345!', 'Пароль123456']) {
      expect(weakPasswordReason(p, policy), p).not.toBeNull();
    }
  });

  it('последовательности и повтор символа', () => {
    expect(weakPasswordReason('abcdefghijk', policy)).toMatch(/последовательност/);
    expect(weakPasswordReason('9876543210', policy)).toMatch(/последовательност/);
    expect(weakPasswordReason('aaaaaaaaaaaa', policy)).toMatch(/повторяющихся/);
    expect(weakPasswordReason('abababababab', policy)).toMatch(/повторяющихся/);
  });

  it('логин и фамилия в пароле — без учёта регистра; короткие части логина не мешают', () => {
    expect(weakPasswordReason('My-Yurasov.AV-2027', policy)).toMatch(/логин/);
    expect(weakPasswordReason('zz-yurasov-2027x', policy)).toMatch(/логин/);
    expect(weakPasswordReason('ЮРАСОВ-летом-27', { ...policy, login: 'a.b' })).toMatch(/фамилию/);
    expect(weakPasswordReason('Lina-orbit-2027', { minLength: 10, login: 'li.a', name: 'Ли Анна' })).toBeNull();
  });
});

describe('устройство сеанса', () => {
  it('браузер и система из строки User-Agent', () => {
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('Chrome 130 · Windows');
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe('Edge 130 · Windows');
    expect(describeAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')).toBe('Safari 17 · macOS');
    expect(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('Safari 17 · iOS');
    expect(describeAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox 131 · Linux');
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 YaBrowser/24.10.0.0 Safari/537.36')).toBe('Яндекс Браузер 24 · Windows');
    expect(describeAgent(undefined)).toBe('Неизвестное устройство');
  });
});
