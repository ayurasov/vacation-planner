<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useUiStore } from '@/stores/ui';

const ui = useUiStore();
const comment = ref('');
const commentEl = ref<HTMLTextAreaElement | null>(null);

const needComment = computed(() => (ui.confirm?.commentMin ?? 0) > 0);
const canConfirm = computed(() => !needComment.value || comment.value.trim().length >= (ui.confirm?.commentMin ?? 0));

watch(() => ui.confirm, async (c) => {
  comment.value = '';
  if (c?.commentMin) {
    await nextTick();
    commentEl.value?.focus();
  }
});

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') ui.answer(false);
}
</script>

<template>
  <div
    v-if="ui.confirm"
    class="modal-overlay"
    @click.self="ui.answer(false)"
    @keydown="onKey"
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
    >
      <div class="modal-head">
        <div>
          <div class="modal-title">
            {{ ui.confirm.title }}
          </div>
          <div
            v-if="ui.confirm.text"
            class="modal-sub"
          >
            {{ ui.confirm.text }}
          </div>
        </div>
      </div>
      <div
        v-if="needComment"
        class="modal-body"
      >
        <div class="field">
          <label for="confirm-comment">{{ ui.confirm.commentLabel ?? 'Комментарий' }}</label>
          <textarea
            id="confirm-comment"
            ref="commentEl"
            v-model="comment"
            class="input"
            rows="3"
            maxlength="1000"
          />
          <span class="field-hint">Не короче {{ ui.confirm.commentMin }} символов — сотрудник увидит этот текст.</span>
        </div>
      </div>
      <div class="modal-actions">
        <button
          class="btn"
          type="button"
          @click="ui.answer(false)"
        >
          Отмена
        </button>
        <button
          class="btn"
          :class="ui.confirm.danger ? 'btn-danger' : 'btn-primary'"
          type="button"
          :disabled="!canConfirm"
          @click="ui.answer(true, comment.trim())"
        >
          {{ ui.confirm.confirmLabel ?? 'Подтвердить' }}
        </button>
      </div>
    </div>
  </div>
</template>
