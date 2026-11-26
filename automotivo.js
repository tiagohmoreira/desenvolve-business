(() => {
  'use strict';

  const db = window.db;
  const app = document.querySelector('#app');
  const status = document.querySelector('#status');
  const admin = document.querySelector('[data-page="admin"]');
  const account = document.querySelector('#account');
  const params = new URLSearchParams(location.search);
  const imageTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const companyFields = 'id,nome,auto_whatsapp,auto_plano,auto_ativa';
  const productFields = 'id,nome,descricao,preco,custo,estoque,ativo,auto_foto';

  let page = params.has('empresa') || params.has('vitrine') ? 'store' : 'merchant';
  let companyId = null;
  let storeId = params.get('empresa');
  let storePage = 0;
  let productPage = 0;
  let editing = null;
  let revision = 0;
  let busy = false;
  let authUserId;

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function notice(message = '') {
    status.textContent = message;
    status.hidden = !message;
  }

  async function result(request) {
    const { data, error } = await request;
    if (error) throw error;
    return data;
  }

  function companyLink(id) {
    return '?empresa=' + encodeURIComponent(id);
  }

  function choosePage(nextPage) {
    page = nextPage;
    editing = null;
    productPage = 0;
    storePage = 0;
    notice();
    render();
  }

  async function render({ background = false } = {}) {
    const request = ++revision;
    const currentPage = page;
    if (!background) app.innerHTML = '<p>Carregando…</p>';

    try {
      if (currentPage === 'store') {
        const stores = await result(db.rpc('auto_vitrine', { empresa: storeId, pagina: storePage }));
        const shop = stores[0];
        const photos = storeId && shop ? await signedPhotos(shop.produtos, 'foto') : new Map();
        if (request === revision) showStore(stores, photos);
        return;
      }

      const { data: { user }, error } = await db.auth.getUser();
      if (request !== revision) return;
      if (!user) {
        if (error && error.name !== 'AuthSessionMissingError') throw error;
        admin.hidden = true;
        account.textContent = 'Acesso empresarial';
        app.innerHTML = '<h2>Acesso empresarial</h2><p><a href="login.html">Entre para administrar sua empresa.</a></p>';
        return;
      }

      const companies = await result(db.from('empresas').select(companyFields)
        .eq('segmento', 'automotivo').eq('proprietario_id', user.id).order('nome').order('id'));
      if (request !== revision) return;

      account.textContent = 'Minha conta';
      admin.hidden = !companies.length;
      if (!companies.length) {
        app.innerHTML = '<h2>Meu negócio</h2><p><a href="login.html">Cadastre sua empresa automotiva.</a></p>';
        return;
      }

      const company = companies.find(item => String(item.id) === companyId) ?? companies[0];
      companyId = String(company.id);
      if (currentPage === 'admin') {
        showAdmin(companies, company);
      } else if (!company.auto_ativa) {
        app.innerHTML = companySelector(companies) + '<h2>Assinatura suspensa</h2>';
        bindCompanySelector();
      } else {
        const products = await result(db.from('produtos').select(productFields)
          .eq('empresa_id', company.id).order('id').range(productPage * 50, productPage * 50 + 49));
        const photos = await signedPhotos(products, 'auto_foto');
        if (request === revision) showMerchant(companies, company, products, photos);
      }
    } catch {
      if (request !== revision) return;
      if (!background) {
        app.replaceChildren();
        admin.hidden = true;
      }
      notice('Não foi possível carregar os dados. Tente novamente.');
    }
  }

  function companySelector(companies) {
    return `<label>Empresa<select id="company-select">${companies.map(company =>
      `<option value="${escape(company.id)}" ${String(company.id) === companyId ? 'selected' : ''}>
        ${escape(company.nome)}</option>`).join('')}</select></label>`;
  }

  function bindCompanySelector() {
    document.querySelector('#company-select').onchange = event => {
      companyId = event.target.value;
      choosePage(page);
    };
  }

  function showAdmin(companies, company) {
    app.innerHTML = `<h2>Central administrativa</h2>${companySelector(companies)}
      <div class="grid"><div class="card">Minhas empresas<h2>${companies.length}</h2></div>
      <div class="card">Plano da empresa<h2>R$ ${escape(company.auto_plano)}</h2></div></div>
      <div class="card"><h3>${escape(company.nome)}</h3>
      <p>${company.auto_ativa ? 'Ativa' : 'Suspensa'}</p>
      <button id="company-active">${company.auto_ativa ? 'Suspender' : 'Reativar'}</button></div>`;
    bindCompanySelector();
    document.querySelector('#company-active').onclick = event => mutate(event.currentTarget, async () => {
      await result(db.from('empresas').update({ auto_ativa: !company.auto_ativa })
        .eq('id', company.id).eq('auto_ativa', company.auto_ativa).select('id').single());
      return 'Situação da empresa atualizada.';
    });
  }

  async function signedPhotos(products, field) {
    const paths = [...new Set(products.map(product => product[field]).filter(Boolean))];
    if (!paths.length) return new Map();
    const { data } = await db.storage.from('automotivo-fotos').createSignedUrls(paths, 120);
    return new Map((data ?? []).filter(photo => photo.signedUrl)
      .map(photo => [photo.path, photo.signedUrl]));
  }

  function image(url) {
    return url ? `<img src="${escape(url)}" alt="" loading="lazy">` : '';
  }

  function pagination(current, length) {
    return `<p>${current > 0 ? '<button data-step="-1">Anterior</button>' : ''}
      ${length === 50 ? '<button data-step="1">Próxima</button>' : ''}</p>`;
  }

  function bindPagination(changePage) {
    app.querySelectorAll('[data-step]').forEach(button => {
      button.onclick = () => {
        changePage(Number(button.dataset.step));
        render();
      };
    });
  }

  function showStore(stores, photos) {
    if (!storeId) {
      app.innerHTML = `<h2>Vitrine automotiva</h2><div class="grid">${stores.map(shop =>
        `<div class="card"><a href="${companyLink(shop.id)}">${escape(shop.nome)}</a></div>`).join('')
        || 'Nenhuma loja disponível.'}</div>${pagination(storePage, stores.length)}`;
      bindPagination(step => { storePage += step; });
      return;
    }

    const shop = stores[0];
    if (!shop) {
      app.innerHTML = '<h2>Vitrine indisponível</h2><a href="?vitrine">Ver lojas</a>';
      return;
    }
    const phone = String(shop.whatsapp).replace(/\D/g, '');
    app.innerHTML = `<h2>${escape(shop.nome)}</h2><div class="grid">${shop.produtos.map(product => `
      <div class="card">${image(photos.get(product.foto))}
      <h3>${escape(product.nome)}</h3><p>${escape(product.descricao)}</p>
      <h3>${money.format(product.preco)}</h3>
      ${phone ? `<a target="_blank" rel="noopener" href="https://wa.me/${phone}?text=${
        encodeURIComponent('Tenho interesse em ' + product.nome)}">Tenho interesse — WhatsApp</a>` : ''}
      </div>`).join('') || 'Nenhum produto disponível.'}</div>
      ${pagination(storePage, shop.produtos.length)}<p><a href="?vitrine">Ver lojas</a></p>`;
    bindPagination(step => { storePage += step; });
  }

  function showMerchant(companies, company, products, photos) {
    const product = products.find(item => item.id === editing);
    app.innerHTML = `<h2>Meu negócio</h2>${companySelector(companies)}
      <p><a href="${companyLink(company.id)}">Abrir vitrine da empresa</a></p>
      <form id="settings">
        <label>Nome da loja<input name="name" maxlength="150" required value="${escape(company.nome)}"></label>
        <label>WhatsApp com DDI e DDD<input name="phone" inputmode="tel" value="${escape(company.auto_whatsapp)}"></label>
        <label>Plano<select name="plan">${['29,90', '59,90', '99,90'].map(plan =>
          `<option ${plan === company.auto_plano ? 'selected' : ''}>${plan}</option>`).join('')}</select></label>
        <button>Salvar configurações</button>
      </form>
      <form id="product">
        <h3>${product ? 'Editar produto ou veículo' : 'Cadastrar produto ou veículo'}</h3>
        <label>Nome<input name="name" required value="${escape(product?.nome)}"></label>
        <label>Preço de venda (R$)<input name="price" type="number" min="0" step=".01" required value="${escape(product?.preco)}"></label>
        <label>Custo (R$)<input name="cost" type="number" min="0" step=".01" required value="${escape(product?.custo ?? 0)}"></label>
        <label>Estoque<input name="stock" type="number" min="0" max="2147483647" step="1" required value="${escape(product?.estoque ?? 1)}"></label>
        <label>Descrição, ano e detalhes<input name="description" value="${escape(product?.descricao)}"></label>
        <label>Foto (JPEG, PNG ou WebP, até 1,5 MB)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>
        ${product?.auto_foto ? '<label><input name="removePhoto" type="checkbox"> Remover foto atual</label>' : ''}
        <label><input name="active" type="checkbox" ${(product?.ativo ?? true) ? 'checked' : ''}> Disponível na vitrine</label>
        <button>${product ? 'Salvar produto' : 'Cadastrar produto'}</button>
        ${product ? '<button id="cancel-edit" type="button">Cancelar</button>' : ''}
      </form>
      <h3>Meu estoque</h3><div class="grid">${products.map((item, index) => `
        <div class="card">${image(photos.get(item.auto_foto))}<h3>${escape(item.nome)}</h3>
        <p>${money.format(item.preco)} • ${item.ativo && item.estoque > 0 ? 'Disponível' : 'Indisponível'}</p>
        <p>Custo ${money.format(item.custo)} • Estoque ${escape(item.estoque)}</p>
        <button data-action="edit" data-index="${index}">Editar</button>
        <button data-action="toggle" data-index="${index}">${item.ativo ? 'Ocultar' : 'Disponibilizar'}</button>
        <button data-action="delete" data-index="${index}">Excluir</button></div>`).join('')
        || 'Nenhum produto nesta página.'}</div>${pagination(productPage, products.length)}`;

    bindCompanySelector();
    bindPagination(step => { productPage += step; editing = null; });
    document.querySelector('#settings').onsubmit = event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      mutate(event.submitter, async () => {
        const nome = String(fields.get('name')).trim();
        const phone = String(fields.get('phone')).replace(/\D/g, '');
        if (!nome || (phone && (phone.length < 10 || phone.length > 15))) {
          throw new InputError('Informe o nome da loja e um WhatsApp válido com DDI e DDD.');
        }
        await result(db.from('empresas').update({ nome, auto_whatsapp: phone, auto_plano: fields.get('plan') })
          .eq('id', company.id).select('id').single());
        return 'Configurações salvas.';
      });
    };
    document.querySelector('#product').onsubmit = event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      mutate(event.submitter, async () => {
        const message = await saveProduct(company, product, fields);
        editing = null;
        return message;
      });
    };
    if (product) document.querySelector('#cancel-edit').onclick = () => {
      editing = null;
      render();
    };
    app.querySelectorAll('[data-action]').forEach(button => {
      button.onclick = () => {
        if (busy) return;
        const item = products[Number(button.dataset.index)];
        if (button.dataset.action === 'edit') {
          editing = item.id;
          showMerchant(companies, company, products, photos);
          document.querySelector('#product input').focus();
        } else if (button.dataset.action === 'toggle') {
          mutate(button, async () => {
            await result(db.from('produtos').update({ ativo: !item.ativo })
              .eq('empresa_id', company.id).eq('id', item.id).eq('ativo', item.ativo).select('id').single());
            return 'Disponibilidade atualizada.';
          });
        } else if (confirm('Excluir este produto do estoque?')) {
          mutate(button, async () => {
            const deleted = await result(db.from('produtos').delete().eq('empresa_id', company.id)
              .eq('id', item.id).select('auto_foto').single());
            if (editing === item.id) editing = null;
            return removePhoto(deleted.auto_foto, 'Produto excluído.');
          });
        }
      };
    });
  }

  class InputError extends Error {}

  async function mutate(button, action) {
    if (busy) return;
    const request = revision;
    busy = true;
    if (button) button.disabled = true;
    notice('Salvando…');
    try {
      const message = await action();
      if (request === revision) {
        notice(message);
        await render();
      }
    } catch (error) {
      if (request === revision) {
        notice(error instanceof InputError ? error.message : 'A alteração não foi confirmada. Verifique os dados e tente novamente.');
      }
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  async function removePhoto(path, message) {
    if (!path) return message;
    try {
      await result(db.storage.from('automotivo-fotos').remove([path]));
      return message;
    } catch {
      return message + ' A foto anterior ficou pendente de remoção.';
    }
  }

  async function saveProduct(company, product, fields) {
    const nome = String(fields.get('name')).trim();
    const preco = fields.get('price');
    const custo = fields.get('cost');
    const estoque = Number(fields.get('stock'));
    if (!nome || !preco || !custo || !Number.isFinite(Number(preco)) || !Number.isFinite(Number(custo))
        || Number(preco) < 0 || Number(custo) < 0 || !Number.isInteger(estoque) || estoque < 0) {
      throw new InputError('Preencha o nome, o custo, o preço e o estoque com valores válidos.');
    }

    const file = fields.get('photo');
    const previous = product?.auto_foto ?? null;
    let uploaded = null;
    if (file.size) {
      const extension = imageTypes[file.type];
      if (!extension || file.size > 1500000) throw new InputError('Use uma imagem JPEG, PNG ou WebP de até 1,5 MB.');
      uploaded = company.id + '/' + crypto.randomUUID() + '.' + extension;
      await result(db.storage.from('automotivo-fotos').upload(uploaded, file));
    }
    const auto_foto = uploaded ?? (fields.has('removePhoto') ? null : previous);
    const values = { nome, descricao: fields.get('description'), preco, custo, estoque, ativo: fields.has('active'), auto_foto };

    try {
      if (product) {
        const update = db.from('produtos').update(values).eq('empresa_id', company.id).eq('id', product.id);
        for (const field of Object.keys(values)) {
          if (product[field] === null) update.is(field, null);
          else update.eq(field, product[field]);
        }
        const saved = await result(update.select('id').maybeSingle());
        if (!saved) throw new InputError('O produto foi alterado. Abra o estoque novamente antes de editar.');
      } else {
        await result(db.from('produtos').insert({ ...values, empresa_id: company.id }).select('id').single());
      }
    } catch (error) {
      // O Storage impede a exclusão se a gravação tiver sido confirmada no banco.
      if (uploaded) await removePhoto(uploaded, '');
      throw error;
    }
    return removePhoto(previous !== auto_foto ? previous : null, 'Produto salvo.');
  }

  document.querySelectorAll('[data-page]').forEach(button => {
    button.onclick = () => {
      if (button.dataset.page === 'store') storeId = null;
      choosePage(button.dataset.page);
    };
  });

  if (!db) {
    notice('Não foi possível conectar ao Supabase.');
    return;
  }

  db.auth.onAuthStateChange((event, session) => {
    const userId = session?.user?.id ?? null;
    if (authUserId === userId && event !== 'SIGNED_OUT') return;
    authUserId = userId;
    if (authUserId === null || !admin.hidden) {
      admin.hidden = true;
      companyId = null;
      editing = null;
      notice();
      if (page !== 'store') app.replaceChildren();
      ++revision;
    }
    setTimeout(() => render({ background: page === 'store' }), 0);
  });

  function refreshStore() {
    if (page === 'store' && !document.hidden) render({ background: true });
  }

  document.addEventListener('visibilitychange', refreshStore);
  setInterval(refreshStore, 30000);
})();
