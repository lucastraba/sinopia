<script setup lang="ts">
import type { LinkExample } from '../../model';
import type { MapIndex, Mode } from '../mapIndex';
import { exampleFile, exampleTag } from '../overview';

defineProps<{ index: MapIndex; examples: LinkExample[]; mode: Mode }>();
defineEmits<{ openFile: [id: string] }>();
</script>

<template>
  <ul class="exs">
    <li v-for="example in examples" :key="`${example.from}|${example.to}|${example.kind}|${example.label}`" class="ex">
      <template v-for="end in (['from', 'to'] as const)" :key="end">
        <button type="button" :class="end" :data-test-id="`example-${end}`" @click="$emit('openFile', example[end])">
          <code v-if="mode === 'dev'">{{ example[end] }}</code>
          <template v-else>
            {{ exampleFile(index, example[end], mode).label }}
            <span class="hint">{{ exampleFile(index, example[end], mode).hint }}</span>
          </template>
        </button>
      </template>
      <span v-if="exampleTag(example, mode)" class="tag">{{ exampleTag(example, mode) }}</span>
    </li>
  </ul>
</template>
