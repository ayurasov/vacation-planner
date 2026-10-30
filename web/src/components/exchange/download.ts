// Сохранение выгрузки: файл с сервера → ссылка «скачать» без перехода со страницы.
import { api } from '@/api/client';

export async function saveDownload(path: string, filename: string): Promise<void> {
  const blob = await api.download(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
