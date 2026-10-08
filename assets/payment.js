(() => {
  'use strict';
  let sdkReady;
  function sdk() {
    if (window.MercadoPago) return Promise.resolve();
    if (!sdkReady) sdkReady = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://sdk.mercadopago.com/js/v2';
      script.onload = resolve;
      script.onerror = () => { sdkReady = null; script.remove(); reject(new Error('Não foi possível carregar os campos seguros. Tente novamente.')); };
      document.head.append(script);
    });
    return sdkReady;
  }
  window.BotAvaPayment = {
    async open({api, token, dialog, form, onClose}) {
      const session = await api('/session', {token});
      if (session.method === 'card') await sdk();
      const panel = document.createElement('section');
      panel.id = 'embedded-payment';
      panel.innerHTML = `<div class="payment-head"><span class="eyebrow">PAGAMENTO SEGURO</span><button type="button" class="close" aria-label="Fechar pagamento">×</button></div>
        <div class="payment-summary"><h2></h2><p class="payment-total"></p></div>
        <p class="payment-status" role="status"></p><div id="card-payment" hidden></div>
        <div class="pix-details" hidden><img class="pix-image" alt="QR Code Pix"><p class="payment-expiry"></p><label for="pix-code">Pix copia e cola</label><textarea id="pix-code" readonly></textarea><div class="payment-actions"><button class="button secondary copy-pix" type="button">Copiar código Pix</button></div></div>
        <div class="payment-actions"><button class="button pay-pix" type="button" hidden>Gerar Pix</button><button class="button secondary retry-payment" type="button" hidden>Consultar / repetir tentativa</button></div>
        <a class="button download-app" hidden>Baixar BOT AVA para Windows</a><p class="secure-note">Processado pelo Mercado Pago. Os dados do cartão são enviados diretamente pelos campos seguros.</p>`;
      panel.querySelector('h2').textContent = session.method === 'card' ? 'Pagar com cartão' : 'Pagar com Pix';
      panel.querySelector('.payment-total').textContent = (session.amount_cents / 100).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
      const status = panel.querySelector('.payment-status');
      const close = panel.querySelector('.close');
      const retry = panel.querySelector('.retry-payment');
      const pixButton = panel.querySelector('.pay-pix');
      let controller, timer, submitted = false, sending = false, disposed = false, attempts = 0, lastForm;
      form.hidden = true;
      dialog.classList.add('with-payment');
      dialog.append(panel);
      panel.scrollIntoView({block:'start'});
      const setStatus = (message, error = false) => {
        status.textContent = message;
        status.classList.toggle('payment-error', error);
      };
      const destroy = async () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        dialog.removeEventListener('cancel', preventCancel);
        dialog.removeEventListener('close', destroy);
        if (controller) await controller.unmount();
        panel.remove();
        dialog.classList.remove('with-payment');
        form.hidden = false;
        onClose();
      };
      const preventCancel = event => { if (sending) event.preventDefault(); };
      dialog.addEventListener('cancel', preventCancel);
      dialog.addEventListener('close', destroy);
      close.addEventListener('click', () => { if (!sending) dialog.close(); });
      function showResult(result) {
        if (disposed) return;
        clearTimeout(timer);
        retry.hidden = true;
        if (result.status_token && submitted) history.replaceState(null, '', location.pathname + location.search + '#pagamento=' + result.status_token);
        if (result.status === 'paid' && result.access_ready) {
          setStatus('Pagamento confirmado! Abra o BOT AVA com o CPF da compra e clique em Atualizar licença.');
          const download = panel.querySelector('.download-app');
          download.href = document.getElementById('download-link').href;
          download.hidden = false;
          panel.querySelector('#card-payment').hidden = true;
          panel.querySelector('.pix-details').hidden = true;
          pixButton.hidden = true;
          return;
        }
        if (['failed','refunded','charged_back','expired'].includes(result.status)) {
          setStatus('Pagamento não aprovado. Confira com seu banco ou fale com o suporte antes de iniciar outra compra.', true);
          panel.querySelector('#card-payment').hidden = true;
          pixButton.hidden = true;
          return;
        }
        if (result.qr_code) {
          panel.querySelector('.pix-details').hidden = false;
          panel.querySelector('#pix-code').value = result.qr_code;
          const img = panel.querySelector('.pix-image');
          const validImage = /^[A-Za-z0-9+/=]+$/.test(result.qr_code_base64 || '');
          img.hidden = !validImage;
          if (validImage) img.src = 'data:image/png;base64,' + result.qr_code_base64;
          if (result.expires_at) panel.querySelector('.payment-expiry').textContent = 'Válido até ' + new Date(result.expires_at).toLocaleString('pt-BR');
          pixButton.hidden = true;
        }
        setStatus('Aguardando confirmação do pagamento. Não faça outra compra enquanto esta estiver em análise.');
        if (++attempts < 60) timer = setTimeout(check, 10000);
        else { setStatus('A confirmação ainda não chegou. Consulte o suporte antes de pagar novamente.'); retry.hidden = false; }
      }
      async function check() {
        try { showResult(await api('/embedded-status', {session_token:session.session_token})); }
        catch (e) { if (!disposed) { setStatus(e.message, true); retry.hidden = false; } }
      }
      async function submit(cardForm) {
        if (sending || disposed) return;
        sending = true;
        submitted = true;
        close.disabled = true;
        retry.disabled = true;
        pixButton.disabled = true;
        lastForm = cardForm;
        setStatus('Processando pagamento…');
        try {
          const result = await api('/pay', {session_token:session.session_token, form:cardForm, device_id:window.MP_DEVICE_SESSION_ID || ''});
          panel.querySelector('#card-payment').hidden = true;
          showResult(result);
        } catch (e) {
          setStatus(e.message, true);
          panel.querySelector('#card-payment').hidden = true;
          pixButton.hidden = true;
          retry.hidden = false;
        } finally { sending = false; close.disabled = false; retry.disabled = false; pixButton.disabled = false; }
      }
      retry.addEventListener('click', async () => {
        if (lastForm !== undefined) await submit(lastForm);
        else await check();
      });
      panel.querySelector('.copy-pix').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(panel.querySelector('#pix-code').value); setStatus('Código Pix copiado. Aguardando confirmação.'); }
        catch { panel.querySelector('#pix-code').select(); setStatus('Selecione e copie o código Pix acima.'); }
      });
      if (session.status !== 'pending') { submitted = true; showResult(session); return; }
      if (session.qr_code) { submitted = true; showResult(session); return; }
      if (session.method === 'pix') {
        setStatus('Pagamento único. A licença é liberada após a confirmação do Pix.');
        pixButton.hidden = false;
        pixButton.addEventListener('click', () => submit({}));
      } else {
        panel.querySelector('#card-payment').hidden = false;
        setStatus('Carregando campos seguros…');
        try {
          controller = await new window.MercadoPago(session.public_key, {locale:'pt-BR'}).bricks().create('cardPayment', 'card-payment', {
            initialization:{amount:session.amount_cents / 100, payer:{email:session.email, identification:{type:'CPF',number:session.cpf}}},
            customization:{paymentMethods:{minInstallments:1,maxInstallments:6,types:{included:['credit_card']}},visual:{hideFormTitle:true,style:{theme:'default',customVariables:{baseColor:'#c92559',borderRadiusMedium:'4px',formPadding:'0px'}}}},
            callbacks:{onReady:() => setStatus('Confira o total e as parcelas antes de confirmar. Compra sem renovação automática.'),
              onError:() => setStatus('Confira os campos do cartão. Se o formulário não carregar, feche e tente novamente.', true),
              onSubmit:cardForm => submit(cardForm)}
          });
          if (disposed) await controller.unmount();
        } catch { setStatus('Não foi possível carregar o cartão. Feche esta janela e tente novamente.', true); }
      }
    }
  };
})();
