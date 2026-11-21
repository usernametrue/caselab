<template>
  <!-- Document editor of the drafting trainers: formatting toolbar, the scaffold as sections to insert at any moment.
       v-model holds the HTML copy, @text gives the plain text the grading reads. -->
  <div class="flex flex-col gap-4">
    <div v-if="sections.length" class="card p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="eyebrow">{{ t('task.scaffold') }}</span>
        <button v-if="missing.length" class="btn btn-link" @click="insertAll">
          <Icon name="plus" :size="16" /> {{ missing.length === sections.length ? t('task.insertScaffold') : t('editor.insertMissing', { n: missing.length }) }}
        </button>
      </div>
      <ol class="mt-3 flex flex-col gap-1.5 text-sm">
        <li v-for="(s, i) in sections" :key="i">
          <button type="button" class="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-brand-tint" @mousedown.prevent @click="goToSection(i)">
            <span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold" :class="present[i] ? 'bg-ok-soft text-ok-dark' : 'bg-brand-tint text-brand-dark'">
              <Icon v-if="present[i]" name="check" :size="12" /><template v-else>{{ i + 1 }}</template>
            </span>
            <span class="min-w-0 flex-1">
              <b>{{ s.title }}</b>
              <span v-if="s.hint" class="block text-ink-mute">{{ s.hint }}</span>
            </span>
            <span class="shrink-0 text-xs font-semibold text-brand">{{ present[i] ? t('editor.goTo') : t('editor.insert') }}</span>
          </button>
        </li>
      </ol>
    </div>

    <div class="card overflow-hidden">
      <div class="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-line bg-white px-2 py-1.5">
        <template v-for="(group, gi) in toolbar" :key="gi">
          <span v-if="gi" class="mx-0.5 h-5 w-px bg-line" />
          <button v-for="b in group" :key="b.icon" type="button" class="tool-btn" :class="{ 'is-on': b.active?.() }"
            :title="t(`editor.${b.label}`)" :aria-label="t(`editor.${b.label}`)" :disabled="!editor || b.disabled?.()" @mousedown.prevent @click="b.run()">
            <Icon :name="b.icon" :size="17" />
          </button>
        </template>
      </div>
      <div v-if="lockedBefore" class="doc-text border-b border-line bg-paper px-6 py-4 text-ink-soft">{{ lockedBefore }}</div>
      <EditorContent :editor="editor" class="doc-editor" />
      <div v-if="lockedAfter" class="doc-text border-t border-line bg-paper px-6 py-4 text-ink-soft">{{ lockedAfter }}</div>
      <div class="border-t border-line px-6 py-2 text-xs text-ink-mute">{{ t('task.chars', { n: charCount }) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Placeholder } from '@tiptap/extensions'
import type { Node as PmNode } from '@tiptap/pm/model'
import Icon from '@/components/ui/Icon.vue'

export interface ScaffoldSection { title: string; hint?: string }

const props = withDefaults(defineProps<{
  modelValue: string
  sections?: ScaffoldSection[]
  placeholder?: string
  lockedBefore?: string
  lockedAfter?: string
}>(), { sections: () => [], placeholder: '', lockedBefore: '', lockedAfter: '' })
const emit = defineEmits<{ 'update:modelValue': [html: string]; text: [text: string] }>()
const { t } = useI18n()

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.:]+$/, '')
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// An older draft or answer has only plain text: every line becomes a paragraph
function toHtml(value: string) {
  if (!value) return ''
  if (/^\s*</.test(value)) return value
  return value.split('\n').map(l => `<p>${escapeHtml(l)}</p>`).join('')
}

// Plain text for the grading: one block per line, list items keep their markers
function plainText(doc: PmNode) {
  const lines: string[] = []
  doc.forEach(node => {
    if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
      let n = node.attrs.start ?? 1
      node.forEach(item => { lines.push(`${node.type.name === 'orderedList' ? `${n++}.` : '-'} ${item.textContent}`) })
    } else lines.push(node.textContent)
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// Section headings of the document with their positions
function headings(doc: PmNode) {
  const list: { text: string; pos: number }[] = []
  doc.forEach((node, offset) => { if (node.type.name === 'heading') list.push({ text: node.textContent, pos: offset }) })
  return list
}

// The hint of the section an empty paragraph belongs to
function hintAt(doc: PmNode, pos: number) {
  let current = ''
  doc.forEach((node, offset) => { if (offset < pos && node.type.name === 'heading') current = node.textContent })
  if (!current) return ''
  const s = props.sections.find(x => norm(x.title) === norm(current))
  return s?.hint || t('editor.sectionPlaceholder', { section: current })
}

const docVersion = ref(0)
const charCount = ref(0)

const editor = useEditor({
  content: toHtml(props.modelValue),
  extensions: [
    StarterKit.configure({ heading: { levels: [3] }, code: false, codeBlock: false, blockquote: false, horizontalRule: false, link: false }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Placeholder.configure({
      showOnlyCurrent: false,
      placeholder: ({ editor: ed, node, pos }) => {
        if (node.type.name === 'heading') return t('editor.headingPlaceholder')
        if (ed.isEmpty) return props.placeholder
        return hintAt(ed.state.doc, pos)
      }
    })
  ],
  onCreate: ({ editor: ed }) => { charCount.value = plainText(ed.state.doc).length },
  onUpdate: ({ editor: ed }) => {
    docVersion.value++
    const text = plainText(ed.state.doc)
    charCount.value = text.length
    emit('update:modelValue', ed.isEmpty ? '' : ed.getHTML())
    emit('text', text)
  }
})

// A new value from outside (rework, restored draft) replaces the content
watch(() => props.modelValue, v => {
  const ed = editor.value
  if (!ed) return
  const current = ed.isEmpty ? '' : ed.getHTML()
  if (v === current) return
  ed.commands.setContent(toHtml(v), { emitUpdate: false })
  charCount.value = plainText(ed.state.doc).length
  docVersion.value++
})

const present = computed(() => {
  void docVersion.value
  const ed = editor.value
  if (!ed) return props.sections.map(() => false)
  const hs = headings(ed.state.doc).map(h => norm(h.text))
  return props.sections.map(s => hs.includes(norm(s.title)))
})
const missing = computed(() => props.sections.filter((_, i) => !present.value[i]))

// Inserts section i before the next section already in the document, or at the end; returns the cursor position
function insertSection(i: number): number | null {
  const ed = editor.value
  if (!ed) return null
  const doc = ed.state.doc
  const hs = headings(doc)
  const block = [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: props.sections[i].title }] },
    { type: 'paragraph' }
  ]
  if (ed.isEmpty) {
    ed.commands.setContent({ type: 'doc', content: block }, { emitUpdate: true })
    return 1 + props.sections[i].title.length + 2
  }
  let at = doc.content.size
  for (let j = i + 1; j < props.sections.length; j++) {
    const h = hs.find(x => norm(x.text) === norm(props.sections[j].title))
    if (h) { at = h.pos; break }
  }
  ed.chain().insertContentAt(at, block).run()
  // heading open + text + close, then into the paragraph
  return at + props.sections[i].title.length + 2 + 1
}

function goToSection(i: number) {
  const ed = editor.value
  if (!ed) return
  let cursor: number | null
  if (present.value[i]) {
    const h = headings(ed.state.doc).find(x => norm(x.text) === norm(props.sections[i].title))!
    const heading = ed.state.doc.nodeAt(h.pos)!
    cursor = Math.min(h.pos + heading.nodeSize + 1, ed.state.doc.content.size)
  } else cursor = insertSection(i)
  // focus(position) puts the cursor there after the click on the list took the focus away
  if (cursor != null) ed.chain().focus(Math.min(cursor, ed.state.doc.content.size)).scrollIntoView().run()
}

function insertAll() {
  const ed = editor.value
  if (!ed) return
  let first: number | null = null
  props.sections.forEach((_, i) => {
    if (present.value[i]) return
    const c = insertSection(i)
    docVersion.value++
    if (first == null) first = c
  })
  if (first != null) ed.chain().focus(Math.min(first, ed.state.doc.content.size)).scrollIntoView().run()
}

interface ToolButton { icon: string; label: string; run: () => void; active?: () => boolean; disabled?: () => boolean }
const chain = () => editor.value!.chain().focus()
const toolbar = computed<ToolButton[][]>(() => {
  void docVersion.value
  const ed = editor.value
  const is = (name: string, attrs?: Record<string, unknown>) => Boolean(ed?.isActive(name, attrs))
  const align = (a: string) => Boolean(ed?.isActive({ textAlign: a }))
  return [
    [
      { icon: 'undo', label: 'undo', run: () => chain().undo().run(), disabled: () => !ed?.can().undo() },
      { icon: 'redo', label: 'redo', run: () => chain().redo().run(), disabled: () => !ed?.can().redo() }
    ],
    [
      { icon: 'heading', label: 'heading', run: () => chain().toggleHeading({ level: 3 }).run(), active: () => is('heading') },
      { icon: 'bold', label: 'bold', run: () => chain().toggleBold().run(), active: () => is('bold') },
      { icon: 'italic', label: 'italic', run: () => chain().toggleItalic().run(), active: () => is('italic') },
      { icon: 'underline', label: 'underline', run: () => chain().toggleUnderline().run(), active: () => is('underline') }
    ],
    [
      { icon: 'alignLeft', label: 'alignLeft', run: () => chain().setTextAlign('left').run(), active: () => align('left') },
      { icon: 'alignCenter', label: 'alignCenter', run: () => chain().setTextAlign('center').run(), active: () => align('center') },
      { icon: 'alignRight', label: 'alignRight', run: () => chain().setTextAlign('right').run(), active: () => align('right') },
      { icon: 'alignJustify', label: 'alignJustify', run: () => chain().setTextAlign('justify').run(), active: () => align('justify') }
    ],
    [
      { icon: 'list', label: 'bulletList', run: () => chain().toggleBulletList().run(), active: () => is('bulletList') },
      { icon: 'listOrdered', label: 'orderedList', run: () => chain().toggleOrderedList().run(), active: () => is('orderedList') }
    ]
  ]
})

// The toolbar state follows the cursor
watch(editor, ed => { ed?.on('selectionUpdate', () => { docVersion.value++ }) }, { immediate: true })
onBeforeUnmount(() => editor.value?.destroy())
</script>

<style scoped>
.tool-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 30px;
  border-radius: 8px;
  color: var(--ink-soft, #4b5563);
  transition: background-color 0.15s ease, color 0.15s ease;
}
.tool-btn:hover:not(:disabled) { background: var(--brand-tint, #f3f0ff); color: var(--brand-dark, #4c1d95); }
.tool-btn.is-on { background: var(--brand-soft, #ede9fe); color: var(--brand-dark, #4c1d95); }
.tool-btn:disabled { opacity: 0.35; cursor: default; }

.doc-editor :deep(.ProseMirror) {
  min-height: 460px;
  padding: 24px 28px;
  outline: none;
  font-size: 15px;
  line-height: 1.65;
  color: var(--ink, #111827);
}
.doc-editor :deep(.ProseMirror p) { margin: 0 0 0.5em; }
.doc-editor :deep(.ProseMirror h3) { margin: 1.1em 0 0.4em; font-size: 15px; font-weight: 800; letter-spacing: 0.01em; }
.doc-editor :deep(.ProseMirror h3:first-child) { margin-top: 0; }
.doc-editor :deep(.ProseMirror ul) { list-style: disc; padding-left: 1.4em; margin: 0 0 0.5em; }
.doc-editor :deep(.ProseMirror ol) { list-style: decimal; padding-left: 1.4em; margin: 0 0 0.5em; }
.doc-editor :deep(.ProseMirror li p) { margin: 0; }
.doc-editor :deep(.ProseMirror .is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: var(--ink-mute, #9ca3af);
  font-weight: 400;
}
</style>
