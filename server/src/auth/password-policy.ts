// Политика паролей (v0.6.0, E62-04): длина из правил организации, без логина и фамилии,
// не из списка распространённых, не последовательность и не повтор одного символа.
// Правила состава («заглавная + цифра + знак») намеренно не вводятся: они дают предсказуемые
// пароли вида «Qwerty1!» и не повышают стойкость (NIST SP 800-63B, разд. 5.1.1.2).

/** Самые частые пароли в утечках, включая русскую раскладку и транслит; сравнение без учёта регистра. */
const COMMON = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', '12345678910', '0123456789', '987654321',
  '111111', '1111111', '11111111', '000000', '00000000', '121212', '123123', '123321', '654321', '666666',
  '696969', '777777', '7777777', '888888', '112233', '123qwe', '1q2w3e', '1q2w3e4r', '1q2w3e4r5t',
  '1qaz2wsx', 'zaq12wsx', 'qazwsx', 'qwerty', 'qwerty1', 'qwerty12', 'qwerty123', 'qwertyui', 'qwertyuiop',
  'qwe123', 'qweasd', 'qweasdzxc', 'asdfgh', 'asdfghjk', 'asdfghjkl', 'zxcvbn', 'zxcvbnm', 'azerty',
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'pass1234',
  'admin', 'admin123', 'admin1234', 'administrator', 'root', 'toor', 'master', 'welcome', 'welcome1',
  'letmein', 'login', 'test', 'test123', 'test1234', 'guest', 'changeme', 'default', 'secret', 'access',
  'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'superman', 'batman', 'shadow', 'sunshine',
  'princess', 'starwars', 'whatever', 'trustno1', 'michael', 'jordan', 'killer', 'hello', 'hello123',
  'freedom', 'computer', 'internet', 'samsung', 'apple', 'google', 'mustang', 'charlie', 'maggie',
  'abc123', 'abcdef', 'abcdefg', 'abcdefgh', 'aaaaaa', 'qqqqqq', 'q1w2e3r4', 'q1w2e3r4t5',
  // русская раскладка и транслит
  'йцукен', 'йцукенг', 'йцукенгш', 'йцукенгшщз', 'фывапр', 'фывапролд', 'фывапролджэ', 'ячсмить',
  'пароль', 'пароль1', 'пароль123', 'parol', 'parol123', 'gfhjkm', 'gfhjkm123', 'privet', 'привет',
  'любовь', 'lubov', 'lyubov', 'qwertyйцукен', 'natasha', 'nastya', 'sasha', 'masha', 'marina',
  'svetlana', 'olga', 'tatyana', 'andrey', 'dmitry', 'sergey', 'alexander', 'aleksandr', 'vladimir',
  'zenit', 'spartak', 'cska', 'moscow', 'moskva', 'russia', 'rossiya', 'россия', 'москва',
  // корпоративные шаблоны
  'otpusk', 'otpusk123', 'отпуск', 'vacation', 'vacation1', 'holiday', 'company', 'company1', 'office',
  'office123', 'user', 'user123', 'user1234', 'employee', 'manager', 'manager1', 'support', 'service',
  'winter', 'summer', 'spring', 'autumn', 'zima', 'leto', 'vesna', 'osen', 'зима', 'лето', 'весна', 'осень',
]);

const SEQUENCES = [
  '0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
  'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю',
];

export interface PolicyInput {
  minLength: number;
  login?: string;
  name?: string; // ФИО: фамилия не должна входить в пароль
}

/** Причина, по которой пароль слабый, или null. Текст — для пользователя (документ 5). */
export function weakPasswordReason(password: string, policy: PolicyInput): string | null {
  if (password.length < policy.minLength) return `Пароль должен быть не короче ${policy.minLength} символов`;
  const lower = password.toLowerCase();
  if (new Set(lower).size <= 2) return 'Пароль не должен состоять из одного-двух повторяющихся символов';
  if (isSequence(lower)) return 'Пароль не должен быть последовательностью символов на клавиатуре или в алфавите';
  if (isCommon(lower)) return 'Этот пароль слишком распространён — его подбирают первым';
  const login = policy.login?.toLowerCase().trim() ?? '';
  // Логин целиком и его часть до точки («yurasov» из «yurasov.av»); короткие части не проверяются —
  // иначе «li» из «li.a» запрещал бы половину паролей
  const loginParts = [login, login.split(/[._-]/)[0]].filter((x, i) => x.length >= (i === 0 ? 3 : 4));
  if (loginParts.some((x) => lower.includes(x))) return 'Пароль не должен содержать логин';
  const surname = policy.name?.toLowerCase().trim().split(/\s+/)[0];
  if (surname && surname.length >= 4 && lower.includes(surname)) return 'Пароль не должен содержать фамилию';
  return null;
}

/** Распространённый пароль — сам или с приставкой до 6 цифр и знаков по краям: «Qwerty123!» = «qwerty». */
function isCommon(lower: string): boolean {
  if (COMMON.has(lower)) return true;
  // Цифры, знаки и пробелы по краям; \W здесь не годится — без флага u он захватил бы кириллицу
  const core = lower.replace(/^[\p{N}\p{P}\p{S}\s]{1,6}|[\p{N}\p{P}\p{S}\s]{1,6}$/gu, '');
  return core.length >= 4 && core.length < lower.length && COMMON.has(core);
}

/**
 * Возрастающая или убывающая последовательность из ряда клавиатуры или алфавита длиной в весь пароль;
 * ряд считается кольцом: «123456789012» и «xyzabcdef» — тоже последовательности.
 */
function isSequence(lower: string): boolean {
  if (lower.length < 4) return false;
  return SEQUENCES.some((seq) => {
    const ring = seq.repeat(Math.ceil(lower.length / seq.length) + 1);
    return ring.includes(lower) || [...ring].reverse().join('').includes(lower);
  });
}
