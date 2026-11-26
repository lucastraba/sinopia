<script setup lang="ts">
import { namesTarget, type Talk } from '../overview';

defineProps<{ talks: Talk[] }>();
const verbClass = (verb: string) => `v-${verb.replace(/[^a-z]+/g, '-')}`;
</script>

<template>
  <span v-if="talks.length" class="talks">
    <span v-for="talk in talks" :key="`${talk.dir}|${talk.verb}|${talk.area}`" class="t">
      <span class="dir">{{ talk.dir === 'out' ? '→' : '←' }}</span>
      <template v-if="talk.dir === 'out'">
        <span class="verb" :class="verbClass(talk.verb)">{{ talk.verb }}</span
        ><span v-if="namesTarget(talk.verb, talk.area)" class="who">{{ talk.area }}</span>
      </template>
      <template v-else>
        <span class="who">{{ talk.area }}</span><span class="verb" :class="verbClass(talk.verb)">{{ talk.verb }}</span>
      </template>
      <span class="n">{{ talk.count.toLocaleString('en-US') }}</span>
    </span>
  </span>
</template>
