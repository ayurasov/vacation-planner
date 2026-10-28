// Версия данных организации из потока событий: открытые экраны решают сами, когда перечитать.
import { defineStore } from 'pinia';

export const useLiveStore = defineStore('live', {
  state: () => ({ version: '' }),
});
