// Demo case track "Debt collection under a supply contract" (PRD 4.10). Written for the demo, seeded with status
// "review": an admin reads it and publishes it with one button in the track constructor. Court names and article
// numbers are training material: check them against lex.uz before using the track with students.

const L = (ru: string, uz: string) => ({ ru, uz });

const COURTS = [
    'Юнусабадский межрайонный экономический суд города Ташкента',
    'Юнусабадский межрайонный экономический суд',
    'Yunusobod tumanlararo iqtisodiy sudi'
];

// Template variables: the track fixes their values, so min/max are placeholders
const VARS = {
    debt: { key: 'debt', kind: 'money', label: 'Сумма долга', min: 84000000, max: 84000000, step: 1 },
    contract_date: { key: 'contract_date', kind: 'date', label: 'Дата договора', min: 0, max: 0 },
    delivery_date: { key: 'delivery_date', kind: 'date', label: 'Дата поставки', min: 0, max: 0 },
    payment_due: { key: 'payment_due', kind: 'date', label: 'Срок оплаты', min: 0, max: 0 },
    client: { key: 'client', kind: 'choice', label: 'Клиент', options: [L('ООО «Альфа Поставка»', '«Alfa Yetkazib Berish» MChJ')] },
    debtor: { key: 'debtor', kind: 'choice', label: 'Должник', options: [L('ООО «Бета Трейд»', '«Beta Treyd» MChJ')] }
};

const ROLE = L('Юрист поставщика ({{client}})', 'Yetkazib beruvchining yuristi ({{client}})');

export const DEMO_SCENARIO = {
    seedKey: 'demo-debt.hearing',
    title: 'Взыскание долга за поставленный товар',
    language: 'ru',
    caseText: 'Поставщик взыскивает с покупателя основной долг за товар. Ответчик в отзыве ссылается на просрочку поставки и несоблюдение претензионного порядка.',
    roles: [{ key: 'plaintiff', name: 'Представитель истца', startNodeId: '' }],
    startNodeId: 'n1',
    nodes: [
        { id: 'n1', stage: 'Подготовительная часть', speaker: 'Председательствующий', text: 'Судебное заседание объявляется открытым. Есть ли у сторон ходатайства?', freeTextRubric: '', outcome: '', choices: [
            { id: 'a', text: 'Ходатайствую о приобщении акта сверки и доказательств направления претензии', next: 'n2', verdict: 'correct', explanation: 'Акт сверки подтверждает долг, доказательства направления претензии снимают довод о досудебном порядке.', normRef: 'ст. 68 ЭПК' },
            { id: 'b', text: 'Ходатайств нет, все документы приложены к иску', next: 'n2', verdict: 'acceptable', explanation: 'Документы в деле есть, но довод ответчика о претензии лучше закрыть сразу.', normRef: '' },
            { id: 'c', text: 'Прошу отложить заседание', next: 'n3', verdict: 'wrong', explanation: 'Оснований для отложения нет, это затягивает дело клиента.', normRef: '' }
        ] },
        { id: 'n2', stage: 'Рассмотрение по существу', speaker: 'Председательствующий', text: 'Ответчик утверждает, что товар поставлен с опозданием на 10 дней, и просит уменьшить долг на неустойку. Ваша позиция?', freeTextRubric: 'Различить зачет и встречный иск: неустойку ответчик может взыскивать отдельным требованием; просрочка поставки по документам не подтверждена; сослаться на ГК и договор.', outcome: '', choices: [
            { id: 'd', text: 'Возражаю: просрочка не доказана, неустойка не заявлена встречным иском, долг подтвержден актом сверки', next: 'win', verdict: 'correct', explanation: 'Требование о неустойке без встречного иска суд не рассматривает, а акт сверки подписан ответчиком без замечаний.', normRef: 'ст. 333 ГК' },
            { id: 'e', text: 'Согласен уменьшить долг на половину неустойки ради мирного урегулирования', next: 'partial', verdict: 'acceptable', explanation: 'Уступка без согласования с клиентом и без доказательств просрочки уменьшает взыскание.', normRef: '' },
            { id: 'f', text: 'Затрудняюсь ответить', next: 'loss', verdict: 'wrong', explanation: 'Довод ответчика остался без возражений.', normRef: '' }
        ] },
        { id: 'n3', stage: 'Рассмотрение по существу', speaker: 'Председательствующий', text: 'Суд не нашел оснований для отложения. Ответчик просит отказать в иске из-за несоблюдения претензионного порядка. Ваша позиция?', freeTextRubric: 'Сослаться на направленную претензию, дату ее получения и истечение срока ответа по договору.', outcome: '', choices: [
            { id: 'g', text: 'Претензия направлена и получена, срок ответа истек до подачи иска, порядок соблюден', next: 'partial', verdict: 'correct', explanation: 'Довод верный, но время на отложение уже потеряно.', normRef: '' },
            { id: 'h', text: 'Претензионный порядок для этого спора не обязателен', next: 'loss', verdict: 'wrong', explanation: 'По договору претензионный порядок обязателен.', normRef: '' }
        ] },
        { id: 'win', stage: 'Решение', speaker: 'Председательствующий', text: 'Суд решил: иск удовлетворить полностью, взыскать основной долг и расходы по госпошлине.', freeTextRubric: '', outcome: 'win', choices: [] },
        { id: 'partial', stage: 'Решение', speaker: 'Председательствующий', text: 'Суд решил: иск удовлетворить частично.', freeTextRubric: '', outcome: 'partial', choices: [] },
        { id: 'loss', stage: 'Решение', speaker: 'Председательствующий', text: 'Суд решил: в удовлетворении иска отказать.', freeTextRubric: '', outcome: 'loss', choices: [] }
    ],
    status: 'review'
};

const CASE_BASE = L(
    'Между {{client}} (поставщик) и {{debtor}} (покупатель) заключен договор поставки от {{contract_date}}. Товар поставлен {{delivery_date}}, накладная подписана покупателем без замечаний. Покупатель должен был оплатить {{debt}} до {{payment_due}}, но не заплатил. Договор требует претензионного порядка: срок ответа на претензию - 15 дней. Споры рассматриваются экономическим судом по месту нахождения ответчика; {{debtor}} находится в Юнусабадском районе города Ташкента.',
    '{{client}} (yetkazib beruvchi) va {{debtor}} (xaridor) o\'rtasida {{contract_date}} sanali yetkazib berish shartnomasi tuzilgan. Tovar {{delivery_date}} yetkazib berilgan, yuk xati xaridor tomonidan e\'tirozsiz imzolangan. Xaridor {{debt}} ni {{payment_due}} gacha to\'lashi kerak edi, lekin to\'lamagan. Shartnomada talabnoma tartibi majburiy: talabnomaga javob muddati - 15 kun. Nizolar javobgar joylashgan joydagi iqtisodiy sudda ko\'riladi; {{debtor}} Toshkent shahri Yunusobod tumanida joylashgan.'
);

export const DEMO_TEMPLATES = [
    {
        seedKey: 'demo-debt.claim_letter', taskType: 'draft_full', difficulty: 2, skills: [{ key: 'contract.dispute_clause', weight: 1 }],
        title: L('Претензия покупателю', 'Xaridorga talabnoma'),
        instructions: L('Составь претензию от имени {{client}} о погашении долга.', '{{client}} nomidan qarzni to\'lash haqida talabnoma tuz.'),
        context: { role: ROLE, today: '' }, caseText: CASE_BASE,
        variablesSchema: [VARS.client, VARS.debtor, VARS.contract_date, VARS.delivery_date, VARS.debt, VARS.payment_due],
        scaffold: [
            { title: L('Адресат и отправитель', 'Qabul qiluvchi va jo\'natuvchi'), hint: L('Кому и от кого, реквизиты договора', 'Kimga va kimdan, shartnoma rekvizitlari') },
            { title: L('Обстоятельства', 'Holatlar'), hint: L('Поставка, накладная, срок оплаты', 'Yetkazib berish, yuk xati, to\'lov muddati') },
            { title: L('Требование и срок', 'Talab va muddat'), hint: L('Сумма и срок ответа по договору', 'Summa va shartnoma bo\'yicha javob muddati') },
            { title: L('Последствия', 'Oqibatlar'), hint: L('Обращение в суд, расходы', 'Sudga murojaat, xarajatlar') }
        ],
        referenceAnswer: L(
            'Претензия адресована {{debtor}}, ссылается на договор поставки от {{contract_date}} и накладную от {{delivery_date}}, указывает срок оплаты {{payment_due}} и сумму долга {{debt}}, требует оплатить в 15-дневный срок, предупреждает об обращении в экономический суд со взысканием госпошлины. Подписана уполномоченным лицом, указан способ направления с подтверждением получения.',
            'Talabnoma {{debtor}} ga yo\'llangan, {{contract_date}} sanali shartnoma va {{delivery_date}} sanali yuk xatiga havola qiladi, {{payment_due}} to\'lov muddatini va {{debt}} qarz summasini ko\'rsatadi, 15 kun ichida to\'lashni talab qiladi, davlat bojini undirgan holda iqtisodiy sudga murojaat qilish haqida ogohlantiradi. Vakolatli shaxs imzolagan, olinganini tasdiqlovchi yuborish usuli ko\'rsatilgan.'
        ),
        checklist: [L('Ссылка на договор и накладную', 'Shartnoma va yuk xatiga havola'), L('Точная сумма долга', 'Qarzning aniq summasi'), L('Срок ответа 15 дней', 'Javob muddati 15 kun'), L('Предупреждение о суде', 'Sud haqida ogohlantirish')],
        aiRewrite: false, status: 'review', source: 'ai'
    },
    {
        seedKey: 'demo-debt.filing_card', taskType: 'proc_next_step', difficulty: 2, skills: [{ key: 'jurisdiction.territorial', weight: 1 }, { key: 'fee.property', weight: 0.5 }],
        title: L('Куда и с какой пошлиной подавать иск', 'Da\'voni qayerga va qanday boj bilan berish'),
        instructions: L('Ответ на претензию не пришел, срок истек. Заполни процессуальную карточку: действие, суд, пошлина.', 'Talabnomaga javob kelmadi, muddat o\'tdi. Protsessual kartochkani to\'ldir: harakat, sud, boj.'),
        context: { role: ROLE, today: '' }, caseText: CASE_BASE,
        variablesSchema: [VARS.client, VARS.debtor, VARS.contract_date, VARS.delivery_date, VARS.debt, VARS.payment_due],
        referenceAnswer: L(
            'Подать исковое заявление о взыскании {{debt}} в Юнусабадский межрайонный экономический суд города Ташкента по месту нахождения ответчика (договорная подсудность совпадает с общей). Госпошлина - 2% от цены иска, но не менее 1 БРВ.',
            '{{debt}} ni undirish haqida da\'vo arizasini javobgar joylashgan joy bo\'yicha Toshkent shahar Yunusobod tumanlararo iqtisodiy sudiga berish. Davlat boji - da\'vo summasining 2 foizi, lekin 1 BHMdan kam emas.'
        ),
        process: { acceptableCourts: COURTS, deadline: { ruleCode: '' }, fee: { rateCode: 'property', amountVar: 'debt', instance: 'first' } },
        aiRewrite: false, status: 'review', source: 'ai'
    },
    {
        seedKey: 'demo-debt.claim', taskType: 'draft_full', difficulty: 3, skills: [{ key: 'claim.requisites', weight: 1 }, { key: 'claim.prayer', weight: 0.5 }],
        title: L('Исковое заявление', 'Da\'vo arizasi'),
        instructions: L('Составь исковое заявление о взыскании долга с {{debtor}}.', '{{debtor}} dan qarzni undirish haqida da\'vo arizasini tuz.'),
        context: { role: ROLE, today: '' }, caseText: CASE_BASE,
        variablesSchema: [VARS.client, VARS.debtor, VARS.contract_date, VARS.delivery_date, VARS.debt, VARS.payment_due],
        scaffold: [
            { title: L('Суд и стороны', 'Sud va taraflar'), hint: L('', '') }, { title: L('Цена иска и госпошлина', 'Da\'vo summasi va davlat boji'), hint: L('', '') },
            { title: L('Обстоятельства и доказательства', 'Holatlar va dalillar'), hint: L('', '') }, { title: L('Претензионный порядок', 'Talabnoma tartibi'), hint: L('', '') },
            { title: L('Требования', 'Talablar'), hint: L('', '') }, { title: L('Приложения', 'Ilovalar'), hint: L('', '') }
        ],
        referenceAnswer: L(
            'Иск в Юнусабадский межрайонный экономический суд города Ташкента; истец {{client}}, ответчик {{debtor}}; цена иска {{debt}}; госпошлина 2% от цены иска; обстоятельства: договор от {{contract_date}}, поставка {{delivery_date}}, неоплата к {{payment_due}}; претензия направлена, ответа нет; требование взыскать основной долг и расходы по госпошлине; приложения: договор, накладная, акт сверки, претензия с доказательством получения, платежный документ о госпошлине, документы о полномочиях.',
            'Da\'vo Toshkent shahar Yunusobod tumanlararo iqtisodiy sudiga; da\'vogar {{client}}, javobgar {{debtor}}; da\'vo summasi {{debt}}; davlat boji da\'vo summasining 2 foizi; holatlar: {{contract_date}} sanali shartnoma, {{delivery_date}} yetkazib berish, {{payment_due}} gacha to\'lanmagan; talabnoma yuborilgan, javob yo\'q; asosiy qarz va davlat boji xarajatlarini undirish talabi; ilovalar: shartnoma, yuk xati, solishtirma dalolatnoma, olinganligi tasdiqlangan talabnoma, davlat boji to\'langanligi haqida hujjat, vakolat hujjatlari.'
        ),
        checklist: [L('Надлежащий суд', 'Tegishli sud'), L('Цена иска', 'Da\'vo summasi'), L('Госпошлина', 'Davlat boji'), L('Соблюдение претензионного порядка', 'Talabnoma tartibiga rioya'), L('Перечень приложений', 'Ilovalar ro\'yxati')],
        deterministicCheck: { kind: 'claim_requisites', params: { amountVar: 'debt', feeRateCode: 'property', isSme: false, acceptableCourts: COURTS } },
        aiRewrite: false, status: 'review', source: 'ai'
    },
    {
        seedKey: 'demo-debt.return_ruling', taskType: 'proc_next_step', difficulty: 3, skills: [{ key: 'jurisdiction.territorial', weight: 1 }, { key: 'deadline.first_instance', weight: 0.5 }],
        title: L('Иск возвращен', 'Da\'vo qaytarildi'),
        instructions: L('Суд вернул исковое заявление: иск подан с нарушением подсудности. Что делать дальше? Заполни карточку.', 'Sud da\'vo arizasini qaytardi: da\'vo sudlovlilik buzilgan holda berilgan. Keyin nima qilish kerak? Kartochkani to\'ldir.'),
        context: { role: ROLE, today: '' }, caseText: CASE_BASE,
        variablesSchema: [VARS.client, VARS.debtor, VARS.contract_date, VARS.delivery_date, VARS.debt, VARS.payment_due],
        referenceAnswer: L(
            'Быстрее всего - заново подать иск в надлежащий суд по месту нахождения ответчика: возвращение не препятствует повторному обращению. Обжаловать определение имеет смысл только если суд ошибся, срок на жалобу - не более месяца со дня вынесения определения.',
            'Eng tezi - da\'voni javobgar joylashgan joydagi tegishli sudga qayta berish: qaytarish qayta murojaat qilishga to\'sqinlik qilmaydi. Ajrimga shikoyat qilish faqat sud xato qilgan bo\'lsa ma\'noli, shikoyat muddati - ajrim chiqarilgan kundan boshlab bir oydan ko\'p emas.'
        ),
        process: { acceptableCourts: COURTS, deadline: { ruleCode: 'claim_return_complaint' }, fee: { rateCode: '' } },
        aiRewrite: false, status: 'review', source: 'ai'
    },
    {
        seedKey: 'demo-debt.fix_defects', taskType: 'proc_next_step', difficulty: 3, skills: [{ key: 'fee.property', weight: 1 }, { key: 'deadline.calc_rules', weight: 0.5 }],
        title: L('Иск оставлен без движения', 'Da\'vo harakatsiz qoldirildi'),
        instructions: L('Суд оставил иск без движения: госпошлина уплачена не в том размере. Определи, сколько нужно уплатить и до какого дня устранить недостаток.', 'Sud da\'voni harakatsiz qoldirdi: davlat boji noto\'g\'ri miqdorda to\'langan. Qancha to\'lash kerakligini va kamchilikni qaysi kungacha bartaraf etishni aniqla.'),
        context: { role: ROLE, today: '' }, caseText: CASE_BASE,
        variablesSchema: [VARS.client, VARS.debtor, VARS.contract_date, VARS.delivery_date, VARS.debt, VARS.payment_due],
        referenceAnswer: L(
            'Доплатить госпошлину до 2% от цены иска и представить платежный документ в суд в срок, установленный определением (не более 10 дней); иначе иск будет возвращен.',
            'Davlat bojini da\'vo summasining 2 foizigacha qo\'shimcha to\'lash va to\'lov hujjatini ajrimda belgilangan muddatda (10 kundan ko\'p emas) sudga taqdim etish; aks holda da\'vo qaytariladi.'
        ),
        process: { acceptableCourts: [], deadline: { ruleCode: 'claim_fix_defects' }, fee: { rateCode: 'property', amountVar: 'debt', instance: 'first' } },
        aiRewrite: false, status: 'review', source: 'ai'
    },
    {
        seedKey: 'demo-debt.objections', taskType: 'proc_draft', difficulty: 3, skills: [{ key: 'claim.facts', weight: 1 }, { key: 'contract.liability', weight: 0.5 }],
        // From level 3 the document type is hidden, so the title does not name it
        title: L('Ответ на позицию ответчика', 'Javobgarning pozitsiyasiga javob'),
        instructions: L('Ответчик прислал отзыв (он в папке дела). Составь возражения на отзыв.', 'Javobgar nizo bo\'yicha fikr yubordi (u ish papkasida). Fikrga e\'tirozlar tuz.'),
        context: { role: ROLE, today: '' }, caseText: CASE_BASE,
        variablesSchema: [VARS.client, VARS.debtor, VARS.contract_date, VARS.delivery_date, VARS.debt, VARS.payment_due],
        referenceAnswer: L(
            'Возражения: претензионный порядок соблюден (претензия направлена и получена, срок ответа истек); довод о просрочке поставки не подтвержден, накладная подписана без замечаний; неустойку ответчик вправе заявить только встречным иском, зачет при отсутствии встречного требования не производится; требования поддерживаются в полном объеме.',
            'E\'tirozlar: talabnoma tartibiga rioya qilingan (talabnoma yuborilgan va olingan, javob muddati o\'tgan); yetkazib berishning kechikkani haqidagi dalil tasdiqlanmagan, yuk xati e\'tirozsiz imzolangan; javobgar neustoykani faqat qarshi da\'vo bilan talab qilishi mumkin; talablar to\'liq hajmda qo\'llab-quvvatlanadi.'
        ),
        process: {
            draftDocType: L('Возражения на отзыв ответчика', 'Javobgarning fikriga e\'tirozlar'),
            instructionsHidden: L('Ответчик прислал документ (он в папке дела). Определи, что нужно подать в ответ, и составь этот документ.', 'Javobgar hujjat yubordi (u ish papkasida). Javob sifatida nima berish kerakligini aniqla va shu hujjatni tuz.')
        },
        aiRewrite: false, status: 'review', source: 'ai'
    },
    {
        seedKey: 'demo-debt.hearing', taskType: 'sim_branching', difficulty: 2, skills: [{ key: 'procedure.claim', weight: 1 }],
        title: L('Судебное заседание', 'Sud majlisi'),
        instructions: L('Проведи заседание за истца.', 'Majlisni da\'vogar nomidan o\'tkaz.'),
        context: { role: ROLE, today: '' }, caseText: CASE_BASE,
        variablesSchema: [VARS.client, VARS.debtor, VARS.contract_date, VARS.delivery_date, VARS.debt, VARS.payment_due],
        sim: { role: 'plaintiff' },
        aiRewrite: false, status: 'review', source: 'ai'
    }
];

const T = (k: string) => `@template:demo-debt.${k}`;

export const DEMO_TRACK = {
    seedKey: 'demo-debt',
    title: L('Взыскание долга по договору поставки', 'Yetkazib berish shartnomasi bo\'yicha qarzni undirish'),
    description: L(
        'Покупатель не оплатил товар. Проведи дело от претензии до решения: подсудность, пошлина, иск, отзыв ответчика и заседание. Ошибки ведут к возвращению иска или оставлению без движения.',
        'Xaridor tovar haqini to\'lamadi. Ishni talabnomadan hal qiluv qarorigacha olib bor: sudlovlilik, boj, da\'vo, javobgarning fikri va majlis. Xatolar da\'voni qaytarish yoki harakatsiz qoldirishga olib keladi.'
    ),
    role: L('Юрист поставщика', 'Yetkazib beruvchining yuristi'),
    startDate: '2026-09-14',
    values: [
        { key: 'debt', kind: 'money', value: '84000000', text: L('', '') },
        { key: 'contract_date', kind: 'date', value: '2026-03-02', text: L('', '') },
        { key: 'delivery_date', kind: 'date', value: '2026-04-10', text: L('', '') },
        { key: 'payment_due', kind: 'date', value: '2026-05-11', text: L('', '') },
        { key: 'client', kind: 'text', value: '', text: L('ООО «Альфа Поставка»', '«Alfa Yetkazib Berish» MChJ') },
        { key: 'debtor', kind: 'text', value: '', text: L('ООО «Бета Трейд»', '«Beta Treyd» MChJ') }
    ],
    folder: [
        { title: L('Договор поставки (выдержка)', 'Yetkazib berish shartnomasi (ko\'chirma)'), date: '2026-03-02', text: L(
            '1. Поставщик передает, а покупатель принимает и оплачивает товар по спецификации.\n4.2. Оплата - в течение 30 дней с даты поставки.\n7.1. До обращения в суд сторона направляет претензию; срок ответа - 15 дней с даты получения.\n7.2. Споры рассматриваются экономическим судом по месту нахождения ответчика.',
            '1. Yetkazib beruvchi tovarni topshiradi, xaridor esa spetsifikatsiya bo\'yicha qabul qiladi va haqini to\'laydi.\n4.2. To\'lov - yetkazib berilgan kundan boshlab 30 kun ichida.\n7.1. Sudga murojaat qilishdan oldin taraf talabnoma yuboradi; javob muddati - olingan kundan boshlab 15 kun.\n7.2. Nizolar javobgar joylashgan joydagi iqtisodiy sudda ko\'riladi.'
        ) },
        { title: L('Акт сверки взаимных расчетов', 'O\'zaro hisob-kitoblarni solishtirish dalolatnomasi'), date: '2026-08-31', text: L(
            'Задолженность {{debtor}} перед {{client}} на 31.08.2026 составляет 84 000 000 сум. Подписан обеими сторонами без разногласий.',
            '{{debtor}} ning {{client}} oldidagi qarzi 31.08.2026 holatiga 84 000 000 so\'m. Ikkala tomon tomonidan kelishmovchiliklarsiz imzolangan.'
        ) }
    ],
    firstStageKey: 'claim_letter',
    stages: [
        { key: 'claim_letter', title: L('Претензия', 'Talabnoma'), templateId: T('claim_letter'), daysAfter: 0, weight: 1, setback: false, transitions: [], defaultNext: 'filing_card', defaultCourtAct: '' },
        { key: 'filing_card', title: L('Суд и пошлина', 'Sud va boj'), templateId: T('filing_card'), daysAfter: 22, weight: 1, setback: false, transitions: [], defaultNext: 'claim', defaultCourtAct: '' },
        {
            key: 'claim', title: L('Иск', 'Da\'vo'), templateId: T('claim'), daysAfter: 2, weight: 2, setback: false,
            transitions: [
                { condition: { kind: 'check_failed', param: 'court' }, next: 'return_ruling', courtAct: 'return_claim' },
                { condition: { kind: 'check_failed', param: 'fee' }, next: 'fix_defects', courtAct: 'leave_without_motion' }
            ],
            defaultNext: 'objections', defaultCourtAct: 'accept_claim'
        },
        { key: 'return_ruling', title: L('Возвращение иска', 'Da\'voni qaytarish'), templateId: T('return_ruling'), daysAfter: 5, weight: 1, setback: true, transitions: [], defaultNext: 'claim', defaultCourtAct: '' },
        { key: 'fix_defects', title: L('Без движения', 'Harakatsiz qoldirish'), templateId: T('fix_defects'), daysAfter: 5, weight: 1, setback: true, transitions: [], defaultNext: 'objections', defaultCourtAct: 'accept_claim' },
        {
            key: 'objections', title: L('Позиция ответчика', 'Javobgarning pozitsiyasi'), templateId: T('objections'), daysAfter: 21, weight: 1.5, setback: false,
            opponentBefore: {
                enabled: true,
                title: L('Отзыв ответчика на исковое заявление', 'Javobgarning da\'vo arizasiga fikri'),
                brief: L(
                    'Ответчик {{debtor}} признает получение товара, но утверждает, что товар поставлен с опозданием на 10 дней, и просит уменьшить долг на неустойку 0,5% в день; кроме того, считает претензионный порядок не соблюденным, так как претензию получил неуполномоченный сотрудник. Просит отказать в иске или оставить его без рассмотрения.',
                    'Javobgar {{debtor}} tovarni olganini tan oladi, lekin tovar 10 kun kechikib yetkazilgan deb hisoblaydi va qarzni kuniga 0,5 foiz neustoyka miqdorida kamaytirishni so\'raydi; bundan tashqari, talabnomani vakolatsiz xodim olgani sababli talabnoma tartibiga rioya qilinmagan deb hisoblaydi. Da\'voni rad etish yoki ko\'rmasdan qoldirishni so\'raydi.'
                )
            },
            transitions: [], defaultNext: 'hearing', defaultCourtAct: ''
        },
        {
            key: 'hearing', title: L('Заседание', 'Majlis'), templateId: T('hearing'), daysAfter: 10, weight: 1.5, setback: false,
            transitions: [
                { condition: { kind: 'sim_outcome', param: 'win' }, next: 'outcome:win', courtAct: 'decision_for_client' },
                { condition: { kind: 'sim_outcome', param: 'partial' }, next: 'outcome:partial', courtAct: 'decision_partial' }
            ],
            defaultNext: 'outcome:loss', defaultCourtAct: 'decision_against_client'
        }
    ],
    status: 'review', source: 'ai'
};
