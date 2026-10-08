(() => {
  'use strict';
  const API = 'https://bot-ava-backend.onrender.com/public/store';
  const dialog = document.getElementById('checkout');
  const form = document.getElementById('checkout-form');
  const button = document.getElementById('checkout-submit');
  const error = document.getElementById('checkout-error');
  const summary = document.getElementById('quote');
  document.querySelector('.secure-note').textContent = 'Pagamento protegido pelo Mercado Pago. Não pedimos a senha da sua faculdade.';
  let plan = 'semester';
  let quoteToken = null;
  let busy = false;
  let leadToken = null;
  const leadMatch = location.hash.match(/^#cadastro=([A-Za-z0-9_.-]+)$/);
  const money = cents => (cents / 100).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
  const params = new URLSearchParams(location.search);
  const attribution = {};
  for (const [key, query] of Object.entries({source: 'utm_source', medium: 'utm_medium', campaign: 'utm_campaign', content: 'utm_content', consultant: 'consultor', influencer: 'influencer', referral_code: 'ref'})) {
    attribution[key] = (params.get(query) || params.get(key) || '').slice(0, 120);
  }
  attribution.source ||= 'site';
  async function api(path, data) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(API + path, {method: data ? 'POST' : 'GET', headers: data ? {'Content-Type': 'application/json'} : {}, body: data ? JSON.stringify(data) : undefined, signal: controller.signal});
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Não foi possível continuar. Tente novamente.');
      return body;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('A conexão demorou. Aguarde e tente novamente.');
      if (e instanceof TypeError) throw new Error('Não foi possível conectar ao pagamento. Tente novamente ou fale com o suporte.');
      throw e;
    } finally { clearTimeout(timeout); }
  }
  function resetQuote() {
    quoteToken = null;
    summary.hidden = true;
    summary.replaceChildren();
    button.textContent = 'Confirmar valor';
  }
  const prefillReady = leadMatch ? (async () => {
    const notice = document.createElement('p');
    notice.setAttribute('role', 'status');
    document.querySelector('#planos .section-heading').append(notice);
    notice.textContent = 'Carregando seu pré-cadastro…';
    history.replaceState(null, '', location.pathname + location.search + '#planos');
    try {
      const lead = await api('/prefill', {token: leadMatch[1]});
      for (const key of ['name', 'cpf', 'email', 'phone']) form.elements[key].value = lead[key] || '';
      leadToken = leadMatch[1];
      notice.textContent = 'Pré-cadastro recebido. Escolha seu plano para continuar.';
      document.getElementById('planos').scrollIntoView({block: 'start'});
    } catch (e) {
      notice.textContent = 'Não foi possível recuperar o pré-cadastro. Você pode escolher um plano e informar seus dados novamente.';
    }
  })() : Promise.resolve();
  document.querySelectorAll('[data-plan]').forEach(el => el.addEventListener('click', async () => {
    await prefillReady;
    plan = el.dataset.plan;
    resetQuote();
    error.textContent = '';
    document.getElementById('checkout-title').textContent = 'Plano ' + (plan === 'semester' ? 'Semestral' : 'Anual');
    dialog.showModal();
  }));
  document.getElementById('close-checkout').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.addEventListener('input', () => { if (!busy) resetQuote(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    button.disabled = true;
    error.textContent = '';
    const controls = [...form.querySelectorAll('input')];
    const values = new FormData(form);
    controls.forEach(el => el.disabled = true);
    button.textContent = quoteToken ? 'Abrindo pagamento…' : 'Confirmando valor…';
    try {
      if (quoteToken) {
        if (window.BotAvaPayment) {
          await window.BotAvaPayment.open({api, token: quoteToken, dialog, form, onClose: resetQuote});
        } else {
          throw new Error('Atualize esta página para carregar o novo pagamento integrado.');
        }
      } else {
        const result = await api('/quote', {plan, method: values.get('method'), cpf: values.get('cpf'), name: values.get('name'), email: values.get('email'), phone: values.get('phone'), accepted: values.get('accepted') === 'on', attribution, lead_token: leadToken});
        quoteToken = result.token;
        const title = document.createElement('strong');
        title.textContent = 'Valor do plano: ' + money(result.amount_cents);
        const period = document.createElement('p');
        period.textContent = result.cycle_label || 'Período acadêmico do plano selecionado';
        if (result.expires_at) {
          const iso = String(result.expires_at).slice(0, 10).split('-');
          if (iso.length === 3) period.textContent += ' · Acesso até ' + iso.reverse().join('/');
        }
        const method = document.createElement('p');
        method.textContent = result.method === 'card' ? 'Compra única. Confira o valor de cada parcela e o total antes de pagar.' + (result.promotion ? ' Oferta de primeira compra aplicada.' : '') : 'Pagamento único via Pix.' + (result.promotion ? ' Oferta de primeira compra aplicada.' : ' Preço oficial aplicado.');
        summary.replaceChildren(title, period, method);
        summary.hidden = false;
        summary.scrollIntoView({block: 'nearest'});
      }
    } catch (e) {
      error.textContent = e.message;
      if (e.message.includes('expirou')) leadToken = null;
      resetQuote();
    } finally {
      busy = false;
      controls.forEach(el => el.disabled = false);
      button.disabled = false;
      button.textContent = quoteToken ? 'Continuar para o pagamento →' : 'Confirmar valor';
    }
  });
  const returnMatch = location.hash.match(/^#pagamento=([A-Za-z0-9_.-]+)(?:[?&].*)?$/);
  if (returnMatch) {
    const returnDialog = document.getElementById('payment-return');
    const statusText = document.getElementById('payment-status');
    let attempts = 0;
    let timer;
    returnDialog.showModal();
    document.getElementById('close-return').addEventListener('click', () => returnDialog.close());
    returnDialog.addEventListener('close', () => { clearTimeout(timer); history.replaceState(null, '', location.pathname + location.search); });
    async function check() {
      try {
        const state = await api('/status?token=' + encodeURIComponent(returnMatch[1]));
        if (!returnDialog.open) return;
        if (state.status === 'paid' && state.access_ready) {
          statusText.textContent = 'Pagamento confirmado. Seu acesso está liberado! Instale no Windows e use o CPF informado na compra.';
          document.getElementById('download-link').hidden = false;
          return;
        }
        if (['failed', 'expired', 'refunded', 'charged_back'].includes(state.status)) {
          statusText.textContent = 'O pagamento não está aprovado. Para conferir sua compra, fale com o suporte.';
          return;
        }
        statusText.textContent = 'Aguardando a confirmação do pagamento. A liberação acontece após a aprovação.';
        if (++attempts < 30) timer = setTimeout(check, 10000);
        else statusText.textContent += ' A confirmação ainda não chegou. Consulte o suporte antes de pagar novamente.';
      } catch (e) { statusText.textContent = e.message; }
    }
    check();
  }
})();
