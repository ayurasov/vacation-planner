<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type Department } from '@/api/client';
import AppIcon from '@/components/common/AppIcon.vue';

interface Project { id: number; name: string; managerId: number | null; headcount: number }

const departments = ref<Department[]>([]);
const projects = ref<Project[]>([]);
const error = ref('');
const newName = ref('');

async function reload(): Promise<void> {
  error.value = '';
  try {
    [departments.value, projects.value] = await Promise.all([
      api.get<Department[]>('/departments'),
      api.get<Project[]>('/projects'),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function addDepartment(): Promise<void> {
  const name = newName.value.trim();
  if (!name) return;
  try {
    await api.post('/departments', { name });
    newName.value = '';
    await reload();
  } catch (e) {
    alert((e as Error).message);
  }
}

async function renameDepartment(oldName: string): Promise<void> {
  const name = prompt('Новое название отдела', oldName)?.trim();
  if (!name || name === oldName) return;
  try {
    await api.patch(`/departments/${encodeURIComponent(oldName)}`, { name });
    await reload();
  } catch (e) {
    alert((e as Error).message);
  }
}

async function removeDepartment(d: Department): Promise<void> {
  if (!confirm(`Удалить отдел «${d.name}»?`)) return;
  try {
    await api.del(`/departments/${encodeURIComponent(d.name)}`);
    await reload();
  } catch (e) {
    alert((e as Error).message);
  }
}

async function addProject(): Promise<void> {
  const name = prompt('Название проекта')?.trim();
  if (!name) return;
  try {
    await api.post('/projects', { name });
    await reload();
  } catch (e) {
    alert((e as Error).message);
  }
}

async function removeProject(p: Project): Promise<void> {
  if (!confirm(`Удалить проект «${p.name}»?`)) return;
  try {
    await api.del(`/projects/${p.id}`);
    await reload();
  } catch (e) {
    alert((e as Error).message);
  }
}

onMounted(reload);
</script>

<template>
  <div>
    <div class="view-header">
      <div>
        <div class="view-title">
          Справочники
        </div>
        <div class="view-subtitle">
          Отделы и проекты организации
        </div>
      </div>
    </div>

    <div
      v-if="error"
      class="error-banner"
    >
      {{ error }}
    </div>

    <div class="dirs-grid">
      <div class="card">
        <div class="card-pad">
          <strong>Отделы</strong> <span class="muted">({{ departments.length }})</span>
        </div>
        <div
          class="card-pad"
          style="display: flex; gap: 8px"
        >
          <input
            v-model="newName"
            class="input"
            placeholder="Новый отдел"
            @keyup.enter="addDepartment"
          >
          <button
            class="btn btn-primary"
            :disabled="!newName.trim()"
            @click="addDepartment"
          >
            <AppIcon
              name="plus"
              :size="14"
            />
          </button>
        </div>
        <div
          v-for="d in departments"
          :key="d.name"
          class="grid-row"
          style="grid-template-columns: 1fr 70px 130px"
        >
          <div>{{ d.name }}</div>
          <span class="badge badge-muted">{{ d.headcount }}</span>
          <div style="display: flex; gap: 6px">
            <button
              class="btn btn-sm"
              @click="renameDepartment(d.name)"
            >
              Переим.
            </button>
            <button
              class="btn btn-sm btn-danger"
              :disabled="d.headcount > 0"
              :title="d.headcount ? 'В отделе есть сотрудники' : ''"
              @click="removeDepartment(d)"
            >
              Удалить
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-pad">
          <strong>Проекты</strong> <span class="muted">({{ projects.length }})</span>
        </div>
        <div class="card-pad">
          <button
            class="btn btn-primary"
            @click="addProject"
          >
            <AppIcon
              name="plus"
              :size="14"
            /> Проект
          </button>
        </div>
        <div
          v-for="p in projects"
          :key="p.id"
          class="grid-row"
          style="grid-template-columns: 1fr 70px 90px"
        >
          <div>{{ p.name }}</div>
          <span class="badge badge-muted">{{ p.headcount }}</span>
          <button
            class="btn btn-sm btn-danger"
            :disabled="p.headcount > 0"
            @click="removeProject(p)"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dirs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 14px;
  align-items: start;
}
.card-pad { padding: 12px; border-bottom: 1px solid var(--color-border); }
.muted { color: var(--color-text-muted); }
</style>
