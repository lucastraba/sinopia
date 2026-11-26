<script setup lang="ts">
import { reactive } from 'vue';
import type { ClaimResult } from '../../model';
import type { MapIndex, Mode } from '../mapIndex';
import { claimSource, claimSummary, kindWord, plural } from '../overview';
import LinkExamples from './LinkExamples.vue';

defineProps<{ index: MapIndex; claims: ClaimResult[]; mode: Mode; title: string; sub?: string }>();
defineEmits<{ openFile: [id: string] }>();

const open = reactive<Record<string, boolean>>({});
const pairText = (pair: { from: string; to: string }) => (pair.from === pair.to ? `inside ${pair.from}` : `${pair.from} → ${pair.to}`);
const fmt = (n: number) => n.toLocaleString('en-US');
</script>

<template>
  <section v-if="claims.length" data-test-id="claims">
    <div class="sh">
      <h2>{{ title }}</h2>
      <span v-if="sub" class="sub">{{ sub }}</span>
      <span class="tally"
        ><span class="ok">{{ claims.filter((claim) => claim.holds).length }} hold</span> ·
        <span class="no">{{ claims.filter((claim) => !claim.holds).length }} broken</span></span
      >
    </div>
    <div class="panel">
      <ul>
        <li
          v-for="claim in claims"
          :key="claim.says"
          class="claim"
          :class="[claim.holds ? 'pass' : 'fail', open[claim.says] ? 'open' : '']"
        >
          <button
            type="button"
            class="row"
            :aria-expanded="!!open[claim.says]"
            data-test-id="claim"
            @click="open[claim.says] = !open[claim.says]"
          >
            <span class="mark">
              <svg v-if="claim.holds" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
              <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </span>
            <span style="min-width: 0; flex: 1">
              <span class="says"
                >{{ claim.says }}<span v-if="claim.draft" class="chip draft" title="Written by an agent, not yet confirmed">draft</span
                ><span v-if="claim.enforce" class="chip" style="margin-left: 6px">enforced</span></span
              >
              <span class="status"
                ><b>{{ claimSummary(claim).word }}</b> · {{ claimSummary(claim).detail }}</span
              >
            </span>
            <span class="chev" aria-hidden="true">›</span>
          </button>
          <div v-if="open[claim.says]" class="detail">
            <p v-if="claim.why">{{ claim.why }}</p>
            <template v-if="!claim.holds">
              <h4>Where it breaks</h4>
              <ul class="pairs">
                <li v-for="pair in claim.pairs" :key="`${pair.from}|${pair.to}`">
                  <span>{{ pairText(pair) }}</span><span class="n">{{ fmt(pair.count) }}</span>
                </li>
              </ul>
              <p v-if="claim.pairsTotal > claim.pairs.length" class="more-note">
                and {{ claim.pairsTotal - claim.pairs.length }} more pairs
              </p>
              <p v-if="Object.keys(claim.byKind).length > 1 || mode === 'dev'" class="more-note">
                By kind:
                {{
                  Object.entries(claim.byKind)
                    .map(([kind, n]) => `${kindWord(kind, mode)} ${fmt(n)}`)
                    .join(', ')
                }}
              </p>
              <h4>Examples</h4>
              <LinkExamples :index="index" :examples="claim.examples" :mode="mode" @open-file="(id) => $emit('openFile', id)" />
              <p v-if="claim.count > claim.examples.length" class="more-note">
                and {{ fmt(claim.count - claim.examples.length) }} more.
              </p>
            </template>
            <p v-else>
              {{
                claim.scope
                  ? `The scan checked ${plural(claim.scope, 'link')} this claim covers; none breaks it.`
                  : 'The scan found no link of any kind between the two sides.'
              }}
            </p>
            <pre v-if="mode === 'dev'">{{ claimSource(claim) }}</pre>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
