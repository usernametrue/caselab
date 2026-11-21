// Reference data from the PRD (sections 5.1, 6.1, 8.1-8.4). Items marked [проверить] were not confirmed
// by the full article text in the PRD and must be checked by the team lawyer before the demo.

export const SKILL_TOPICS = [
    { key: 'claim', ru: 'Исковое заявление', uz: "Da'vo arizasi" },
    { key: 'deadline', ru: 'Процессуальные сроки', uz: 'Protsessual muddatlar' },
    { key: 'jurisdiction', ru: 'Подсудность', uz: 'Sudlovlilik' },
    { key: 'fee', ru: 'Госпошлина', uz: 'Davlat boji' },
    { key: 'procedure', ru: 'Виды производства', uz: 'Ish yuritish turlari' },
    { key: 'contract', ru: 'Договор', uz: 'Shartnoma' },
    { key: 'act', ru: 'Судебные акты', uz: 'Sud hujjatlari' },
    { key: 'labor', ru: 'Трудовой договор', uz: 'Mehnat shartnomasi' },
    { key: 'route', ru: 'Обращение в органы', uz: 'Organlarga murojaat' }
];

export const SKILLS: { key: string; ru: string; uz: string }[] = [
    { key: 'claim.requisites', ru: 'Реквизиты иска', uz: "Da'vo rekvizitlari" },
    { key: 'claim.facts', ru: 'Обстоятельства и доказательства', uz: 'Holatlar va dalillar' },
    { key: 'claim.prayer', ru: 'Просительная часть', uz: "Talab qismi" },
    { key: 'claim.attachments', ru: 'Приложения к иску', uz: "Da'voga ilovalar" },
    { key: 'deadline.first_instance', ru: 'Сроки в первой инстанции', uz: 'Birinchi instansiya muddatlari' },
    { key: 'deadline.appeal', ru: 'Апелляционный срок', uz: 'Apellyatsiya muddati' },
    { key: 'deadline.cassation', ru: 'Кассационный срок', uz: 'Kassatsiya muddati' },
    { key: 'deadline.revision', ru: 'Ревизионный срок', uz: 'Taftish muddati' },
    { key: 'deadline.calc_rules', ru: 'Правила исчисления сроков', uz: 'Muddatlarni hisoblash qoidalari' },
    { key: 'jurisdiction.subject', ru: 'Родовая подсудность', uz: "Ish turiga ko'ra sudlovlilik" },
    { key: 'jurisdiction.territorial', ru: 'Территориальная подсудность', uz: 'Hududiy sudlovlilik' },
    { key: 'jurisdiction.exclusive', ru: 'Исключительная подсудность', uz: 'Mutlaq sudlovlilik' },
    { key: 'jurisdiction.contractual', ru: 'Договорная подсудность', uz: 'Shartnomaviy sudlovlilik' },
    { key: 'fee.property', ru: 'Пошлина по имущественному иску', uz: "Mulkiy da'vo bo'yicha boj" },
    { key: 'fee.non_property', ru: 'Пошлина по неимущественному иску', uz: "Nomulkiy da'vo bo'yicha boj" },
    { key: 'fee.appeal', ru: 'Пошлина за жалобы', uz: 'Shikoyatlar uchun boj' },
    { key: 'fee.benefits', ru: 'Льготы по пошлине', uz: "Boj bo'yicha imtiyozlar" },
    { key: 'procedure.order', ru: 'Приказное производство', uz: 'Buyruq tartibida ish yuritish' },
    { key: 'procedure.simplified', ru: 'Упрощенное производство', uz: 'Soddalashtirilgan ish yuritish' },
    { key: 'procedure.claim', ru: 'Исковое производство', uz: "Da'vo tartibida ish yuritish" },
    { key: 'contract.subject', ru: 'Предмет договора', uz: 'Shartnoma predmeti' },
    { key: 'contract.price', ru: 'Цена договора', uz: 'Shartnoma narxi' },
    { key: 'contract.liability', ru: 'Ответственность сторон', uz: 'Taraflarning javobgarligi' },
    { key: 'contract.termination', ru: 'Расторжение договора', uz: 'Shartnomani bekor qilish' },
    { key: 'contract.dispute_clause', ru: 'Порядок разрешения споров', uz: 'Nizolarni hal qilish tartibi' },
    { key: 'act.form', ru: 'Форма судебного акта', uz: 'Sud hujjati shakli' },
    { key: 'act.reasoning', ru: 'Мотивировочная часть', uz: 'Asoslantiruvchi qism' },
    { key: 'act.operative', ru: 'Резолютивная часть', uz: 'Xulosa qismi' },
    { key: 'labor.terms', ru: 'Условия трудового договора', uz: 'Mehnat shartnomasi shartlari' },
    { key: 'labor.pay', ru: 'Оплата труда', uz: "Mehnatga haq to'lash" },
    { key: 'labor.termination', ru: 'Прекращение трудового договора', uz: 'Mehnat shartnomasini bekor qilish' },
    { key: 'labor.liability', ru: 'Ответственность сторон трудового договора', uz: 'Mehnat shartnomasi taraflarining javobgarligi' },
    { key: 'route.qualification', ru: 'Юридическая квалификация ситуации', uz: 'Vaziyatni huquqiy baholash' },
    { key: 'route.body', ru: 'Выбор органа', uz: 'Organni tanlash' },
    { key: 'route.pretrial', ru: 'Досудебный порядок', uz: 'Sudgacha tartib' },
    { key: 'route.application', ru: 'Составление обращения', uz: 'Murojaatni tuzish' },
    { key: 'route.client_interview', ru: 'Опрос клиента', uz: "Mijozdan so'rash" }
];

// PRD 5.1 (revised table with the "route" column)
export const SCORING = [
    { mode: 'draft', weights: { accuracy: 30, completeness: 25, reasoning: 20, form: 15, language: 10 } },
    { mode: 'review', weights: { accuracy: 30, completeness: 30, reasoning: 25, form: 5, language: 10 } },
    { mode: 'process', weights: { accuracy: 45, completeness: 15, reasoning: 25, form: 10, language: 5 } },
    { mode: 'route', weights: { accuracy: 30, completeness: 20, reasoning: 20, form: 20, language: 10 } },
    { mode: 'sim', weights: { accuracy: 25, completeness: 15, reasoning: 30, form: 15, language: 15 } }
];

// PRD 8.4
export const BRV = [
    { value: 412000, validFrom: '2025-08-01', source: 'с 01.08.2025' },
    { value: 440000, validFrom: '2026-09-01', source: 'УП-115 от 23.06.2026' }
];

// PRD 8.4, ЗРУ-600 annex 1 item 2. Appeals are 50% of these (engine parameter "instance").
// SME 50% applies to sub-items "а"-"г" and "е"; only the property claim is confirmed by the PRD example.
export const FEE_RATES = [
    { code: 'property', name: { ru: 'Иск имущественного характера', uz: "Mulkiy xususiyatdagi da'vo" }, kind: 'percent', percent: 2, minBrv: 1, smeDiscount: true, articleRef: 'ЗРУ-600, прил. 1, п. 2' },
    { code: 'non_property', name: { ru: 'Иск неимущественного характера', uz: "Nomulkiy xususiyatdagi da'vo" }, kind: 'fixed', fixedBrv: 10, smeDiscount: false, articleRef: 'ЗРУ-600, прил. 1, п. 2', note: '[проверить подпункт для скидки МСП]' },
    { code: 'bankruptcy', name: { ru: 'Заявление о банкротстве', uz: "Bankrotlik to'g'risidagi ariza" }, kind: 'fixed', fixedBrv: 3, smeDiscount: false, articleRef: 'ЗРУ-600, прил. 1, п. 2', note: '[проверить подпункт для скидки МСП]' },
    { code: 'contract_dispute', name: { ru: 'Спор при заключении, изменении, расторжении хоздоговора', uz: "Xo'jalik shartnomasini tuzish, o'zgartirish, bekor qilishdagi nizo" }, kind: 'fixed', fixedBrv: 10, smeDiscount: false, articleRef: 'ЗРУ-600, прил. 1, п. 2', note: '[проверить подпункт для скидки МСП]' },
    { code: 'copies', name: { ru: 'Дубликаты и копии документов', uz: 'Hujjatlarning dublikatlari va nusxalari' }, kind: 'percent_brv_per_page', percent: 2, smeDiscount: false, articleRef: 'ЗРУ-600, прил. 1, п. 2' },
    { code: 'arbitration_foreign', name: { ru: 'Оспаривание решения третейского суда, исполнительный лист, признание иностранных решений', uz: "Hakamlik sudi qaroriga e'tiroz, ijro varaqasi, xorijiy qarorlarni tan olish" }, kind: 'fixed', fixedBrv: 2, smeDiscount: false, articleRef: 'ЗРУ-600, прил. 1, п. 2', note: '[проверить подпункт для скидки МСП]' }
];

// PRD 8.1-8.2. Unit "days" means calendar days unless the code says otherwise.
export const DEADLINE_RULES = [
    { code: 'order_objection', procedure: 'order', trigger: 'Вручение должнику копии заявления о выдаче приказа', amount: 10, unit: 'days', articleRef: 'ЭПК, ст. 135-147', name: { ru: 'Возражения должника', uz: "Qarzdorning e'tirozlari" }, note: '[проверить точную статью]' },
    { code: 'order_issue', procedure: 'order', trigger: 'Вручение должнику копии заявления', amount: 10, unit: 'days', articleRef: 'ЭПК, ст. 135-147', name: { ru: 'Выдача судебного приказа', uz: 'Sud buyrug\'ini berish' }, note: '[проверить точную статью]' },
    { code: 'order_return', procedure: 'order', trigger: 'Поступление заявления о выдаче приказа', amount: 5, unit: 'days', articleRef: 'ЭПК, ст. 135-147', name: { ru: 'Возвращение или отказ в выдаче приказа', uz: 'Buyruq berishni rad etish yoki qaytarish' }, note: '[проверить точную статью]' },
    { code: 'order_entry_into_force', procedure: 'order', trigger: 'Выдача судебного приказа', amount: 10, unit: 'days', articleRef: 'ЭПК, ст. 135-147', name: { ru: 'Вступление приказа в силу', uz: 'Buyruqning kuchga kirishi' }, note: '[проверить точную статью]' },
    { code: 'order_cancel_application', procedure: 'order', trigger: 'Получение копии судебного приказа', amount: 10, unit: 'days', articleRef: 'ЭПК, ст. 147', name: { ru: 'Заявление об отмене приказа', uz: 'Buyruqni bekor qilish haqida ariza' }, note: '[проверить новую редакцию ст. 147 с 24.07.2026]' },
    { code: 'order_cancel_review', procedure: 'order', trigger: 'Поступление заявления об отмене приказа', amount: 10, unit: 'days', articleRef: 'ЭПК, ст. 147', name: { ru: 'Рассмотрение заявления об отмене приказа', uz: "Buyruqni bekor qilish arizasini ko'rib chiqish" }, note: '[проверить новую редакцию ст. 147 с 24.07.2026]' },
    { code: 'simplified_response', procedure: 'simplified', trigger: 'Определение о рассмотрении в упрощенном порядке', amount: 15, unit: 'days', articleRef: 'ЭПК, ст. 203-1 - 203-5', name: { ru: 'Отзыв в упрощенном производстве', uz: 'Soddalashtirilgan ish yuritishda nizo bo\'yicha fikr' } },
    { code: 'simplified_review', procedure: 'simplified', trigger: 'Определение о рассмотрении в упрощенном порядке', amount: 20, unit: 'days', extendable: false, articleRef: 'ЭПК, ст. 203-1 - 203-5', name: { ru: 'Рассмотрение в упрощенном порядке', uz: "Soddalashtirilgan tartibda ko'rib chiqish" } },
    { code: 'simplified_entry_into_force', procedure: 'simplified', trigger: 'Принятие решения', amount: 10, unit: 'days', articleRef: 'ЭПК, ст. 203-5', name: { ru: 'Вступление решения в силу (упрощенное)', uz: 'Qarorning kuchga kirishi (soddalashtirilgan)' } },
    { code: 'simplified_appeal_review', procedure: 'simplified', trigger: 'Поступление апелляционной жалобы', amount: 15, unit: 'days', articleRef: 'ЭПК, ст. 277 ч. 2', name: { ru: 'Апелляция по упрощенному делу: рассмотрение', uz: "Soddalashtirilgan ish bo'yicha apellyatsiya: ko'rib chiqish" } },
    { code: 'claim_acceptance', procedure: 'claim', trigger: 'Поступление искового заявления', amount: 5, unit: 'days', articleRef: 'ЭПК, ст. 152-155', name: { ru: 'Решение вопроса о принятии иска', uz: "Da'voni qabul qilish masalasini hal qilish" } },
    { code: 'claim_fix_defects', procedure: 'claim', trigger: 'Определение об оставлении без движения', amount: 10, unit: 'days', articleRef: 'ЭПК, ст. 152', name: { ru: 'Устранение недостатков (не более)', uz: 'Kamchiliklarni bartaraf etish (ko\'pi bilan)' }, note: 'Срок устанавливает суд, не более 10 дней [проверить механику]' },
    { code: 'claim_return_complaint', procedure: 'claim', trigger: 'Вынесение определения о возвращении', amount: 1, unit: 'months', articleRef: 'ЭПК, ст. 155, 199', name: { ru: 'Обжалование определения о возвращении', uz: 'Qaytarish haqidagi ajrimga shikoyat' } },
    { code: 'claim_preparation', procedure: 'claim', trigger: 'Поступление иска / принятие к производству', amount: 5, unit: 'days', articleRef: 'ЭПК, ст. 162, 163', name: { ru: 'Определение о подготовке дела', uz: 'Ishni tayyorlash haqida ajrim' } },
    { code: 'claim_preparation_pretrial', procedure: 'claim', trigger: 'Поступление иска / принятие к производству', amount: 10, unit: 'days', articleRef: 'ЭПК, ст. 163-1', name: { ru: 'Подготовка при досудебном заседании', uz: "Sudgacha majlis o'tkazilganda tayyorlash" } },
    { code: 'claim_response', procedure: 'claim', trigger: 'Вынесение определения о подготовке', amount: 20, unit: 'days', articleRef: 'ЭПК, ст. 156, 170', name: { ru: 'Отзыв на иск', uz: "Da'voga nizo bo'yicha fikr" } },
    { code: 'trial', procedure: 'claim', trigger: 'Вынесение определения о подготовке', amount: 1, unit: 'months', extendable: true, articleRef: 'ЭПК, ст. 164', name: { ru: 'Судебное разбирательство', uz: 'Sud muhokamasi' }, note: 'Продление председателем суда не более чем на 1 месяц' },
    { code: 'decision_entry_into_force', procedure: 'claim', trigger: 'Принятие решения', amount: 1, unit: 'months', articleRef: 'ЭПК, ст. 192, 280', name: { ru: 'Вступление решения в силу', uz: 'Qarorning qonuniy kuchga kirishi' }, note: 'При апелляции - со дня принятия постановления апелляционной инстанции, если решение не отменено' },
    { code: 'appeal_filing', procedure: 'claim', trigger: 'Принятие решения', amount: 1, unit: 'months', articleRef: 'ЭПК, ст. 261, 262', name: { ru: 'Подача апелляционной жалобы', uz: 'Apellyatsiya shikoyatini berish' } },
    { code: 'appeal_review', procedure: 'claim', trigger: 'Принятие жалобы к производству', amount: 1, unit: 'months', extendable: true, articleRef: 'ЭПК, ст. 277, 280', name: { ru: 'Рассмотрение апелляции', uz: "Apellyatsiyani ko'rib chiqish" } },
    { code: 'cassation_filing', procedure: 'claim', trigger: 'Вступление в силу решения первой инстанции', amount: 6, unit: 'months', articleRef: 'ЭПК, ст. 282, 285', name: { ru: 'Подача кассационной жалобы', uz: 'Kassatsiya shikoyatini berish' }, note: 'Только на решение, не рассмотренное в апелляции (ст. 282)' },
    { code: 'cassation_restore', procedure: 'claim', trigger: 'Истечение срока кассационного обжалования', amount: 3, unit: 'months', articleRef: 'ЭПК, ст. 285', name: { ru: 'Восстановление кассационного срока', uz: 'Kassatsiya muddatini tiklash' } },
    { code: 'cassation_review', procedure: 'claim', trigger: 'Принятие жалобы к производству', amount: 1, unit: 'months', extendable: true, articleRef: 'ЭПК, ст. 300', name: { ru: 'Рассмотрение кассации', uz: "Kassatsiyani ko'rib chiqish" } },
    { code: 'revision_filing', procedure: 'claim', trigger: 'Вступление акта в силу', amount: 1, unit: 'years', articleRef: 'ЭПК, ст. 310', name: { ru: 'Ревизионная жалоба', uz: 'Taftish shikoyati' } },
    { code: 'revision_after_cassation', procedure: 'claim', trigger: 'Постановление кассационной инстанции', amount: 3, unit: 'months', articleRef: 'ЭПК, ст. 310', name: { ru: 'Ревизия после кассации', uz: 'Kassatsiyadan keyingi taftish' } },
    { code: 'revision_restore', procedure: 'claim', trigger: 'Истечение ревизионного срока', amount: 3, unit: 'months', articleRef: 'ЭПК, ст. 310', name: { ru: 'Восстановление ревизионного срока', uz: 'Taftish muddatini tiklash' } },
    { code: 'limitation_general', procedure: 'general', trigger: 'День, когда лицо узнало или должно было узнать о нарушении', amount: 3, unit: 'years', articleRef: 'ГК РУз', name: { ru: 'Общая исковая давность', uz: "Umumiy da'vo muddati" }, note: '[проверить статьи и специальные сроки]' }
];

// PRD 8.3 fixed holidays. Floating holidays (Ramazan Hayit, Qurbon Hayit) and Cabinet of Ministers
// transfers are announced each year and are added in the admin panel.
const FIXED_HOLIDAYS = [
    { md: '01-01', ru: 'Новый год', uz: 'Yangi yil' },
    { md: '03-08', ru: 'Международный женский день', uz: 'Xalqaro xotin-qizlar kuni' },
    { md: '03-21', ru: 'Навруз', uz: "Navro'z" },
    { md: '05-09', ru: 'День памяти и почестей', uz: 'Xotira va qadrlash kuni' },
    { md: '09-01', ru: 'День независимости', uz: 'Mustaqillik kuni' },
    { md: '10-01', ru: 'День учителя и наставника', uz: "O'qituvchi va murabbiylar kuni" },
    { md: '12-08', ru: 'День Конституции', uz: 'Konstitutsiya kuni' }
];

export const holidaysFor = (years: number[]) =>
    years.flatMap(y => FIXED_HOLIDAYS.map(h => ({ date: `${y}-${h.md}`, type: 'holiday', name: { ru: h.ru, uz: h.uz } })));
