const auth = window.auth;
const db = window.db;

let allCodes = [];
let currentFilter = 'all';
let currentSearch = '';

document.addEventListener('DOMContentLoaded', () => {
  auth.onAuthStateChanged(user => {
    if (!user) {
      window.location.replace('login.html');
      return;
    }

    db.collection('users').doc(user.uid).get().then(doc => {
      if (!doc.exists || doc.data().tenantCode !== 'SUPERADMIN') {
        window.location.replace('login.html');
      } else {
        initializeDashboard();
      }
    }).catch(err => {
      console.error(err);
      window.location.replace('login.html');
    });
  });
});

async function initializeDashboard() {
  loadStats();
  loadCodes();
  loadGlobalUsage();
  setupEventListeners();
}

function setupEventListeners() {
  // Generar código
  document.getElementById('generate-code').onclick = async () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
      await db.collection('tenants').doc(code).set({
        assigned: false,
        blocked: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      alert(`Código generado: ${code}`);
      loadCodes();
      loadStats();
    } catch (error) {
      alert('Error al generar código');
      console.error(error);
    }
  };

  // Actualizar
  document.getElementById('refresh-btn').onclick = () => {
    loadStats();
    loadCodes();
    loadGlobalUsage();
  };

  // Cerrar sesión
  document.getElementById('logout-btn').onclick = () => {
    if (confirm('¿Desea cerrar sesión?')) {
      auth.signOut().then(() => window.location.replace('login.html'));
    }
  };

  // Búsqueda
  document.getElementById('search-codes').addEventListener('input', (e) => {
    currentSearch = e.target.value.toLowerCase().trim();
    renderCodes();
  });

  // Filtro
  document.getElementById('filter-status').addEventListener('change', (e) => {
    currentFilter = e.target.value;
    renderCodes();
  });

  // Modal cerrar
  const closeModal = document.querySelector('.close-modal');
  if (closeModal) {
    closeModal.onclick = () => {
      document.getElementById('tenant-modal').style.display = 'none';
    };
  }

  window.onclick = (e) => {
    const modal = document.getElementById('tenant-modal');
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };
}

async function loadStats() {
  try {
    // Cargar usuarios activos (excluyendo SUPERADMIN)
    const usersSnapshot = await db.collection('users').get();
    const activeUsers = usersSnapshot.docs.filter(doc => {
      const data = doc.data();
      return data.tenantCode && data.tenantCode !== 'SUPERADMIN';
    });
    
    // Cargar códigos
    const codesSnapshot = await db.collection('tenants').get();
    const totalCodes = codesSnapshot.size;
    const assignedCodes = codesSnapshot.docs.filter(doc => doc.data().assigned === true).length;

    // Actualizar estadísticas
    document.getElementById('total-users').textContent = activeUsers.length;
    document.getElementById('total-codes').textContent = totalCodes;
    document.getElementById('assigned-codes').textContent = assignedCodes;
  } catch (error) {
    console.error('Error al cargar estadísticas:', error);
  }
}

async function loadCodes() {
  try {
    const snapshot = await db.collection('tenants').orderBy('createdAt', 'desc').get();
    allCodes = [];
    snapshot.forEach(doc => {
      allCodes.push({ id: doc.id, ...doc.data() });
    });
    renderCodes();
    loadStats();
  } catch (error) {
    console.error('Error al cargar códigos:', error);
    document.getElementById('codes-list').innerHTML = '<div class="error-message">Error al cargar códigos</div>';
  }
}

function renderCodes() {
  const list = document.getElementById('codes-list');
  
  // Filtrar códigos
  let filtered = allCodes;
  
  // Aplicar filtro de estado
  if (currentFilter === 'available') {
    filtered = filtered.filter(code => !code.assigned && !code.blocked);
  } else if (currentFilter === 'assigned') {
    filtered = filtered.filter(code => code.assigned);
  } else if (currentFilter === 'blocked') {
    filtered = filtered.filter(code => code.blocked);
  }
  
  // Aplicar búsqueda
  if (currentSearch) {
    filtered = filtered.filter(code => 
      code.id.toLowerCase().includes(currentSearch)
    );
  }
  
  list.innerHTML = '';
  
  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#666;">No se encontraron códigos</div>';
    return;
  }
  
  filtered.forEach(codeData => {
    const codeItem = document.createElement('div');
    codeItem.className = 'code-item';
    
    if (codeData.assigned) {
      codeItem.classList.add('assigned');
    } else if (codeData.blocked) {
      codeItem.classList.add('blocked');
    } else {
      codeItem.classList.add('available');
    }
    
    const statusClass = codeData.blocked ? 'blocked' : (codeData.assigned ? 'assigned' : 'available');
    const statusText = codeData.blocked ? 'Bloqueado' : (codeData.assigned ? 'Asignado' : 'Disponible');
    
    const createdAt = codeData.createdAt?.toDate?.() || new Date();
    const dateStr = createdAt.toLocaleDateString('es-PE', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
    
    codeItem.innerHTML = `
      <div class="code-info">
        <div class="code-value">${codeData.id}</div>
        <div class="code-meta">
          <span class="code-status ${statusClass}">${statusText}</span>
          <span>Creado: ${dateStr}</span>
        </div>
      </div>
      <div class="code-actions">
        <button class="code-btn copy" data-code="${codeData.id}" title="Copiar código">
          📋 Copiar
        </button>
        ${codeData.assigned ? `
          <button class="code-btn details" data-code="${codeData.id}" title="Ver detalles">
            👁️ Detalles
          </button>
        ` : ''}
        <button class="code-btn block" data-code="${codeData.id}" data-blocked="${codeData.blocked}">
          ${codeData.blocked ? '🔓 Desbloquear' : '🔒 Bloquear'}
        </button>
        ${!codeData.assigned ? `
          <button class="code-btn delete" data-code="${codeData.id}" title="Eliminar código">
            🗑️ Eliminar
          </button>
        ` : ''}
      </div>
    `;
    
    // Event listeners para botones
    codeItem.querySelector('.copy').onclick = (e) => {
      e.stopPropagation();
      copyToClipboard(codeData.id);
    };
    
    if (codeData.assigned) {
      codeItem.querySelector('.details').onclick = (e) => {
        e.stopPropagation();
        showTenantDetails(codeData.id);
      };
    }
    
    codeItem.querySelector('.block').onclick = async (e) => {
      e.stopPropagation();
      await toggleBlockCode(codeData.id, !codeData.blocked);
    };
    
    if (!codeData.assigned) {
      codeItem.querySelector('.delete').onclick = async (e) => {
        e.stopPropagation();
        await deleteCode(codeData.id);
      };
    }
    
    list.appendChild(codeItem);
  });
}

async function showTenantDetails(tenantCode) {
  const modal = document.getElementById('tenant-modal');
  const modalBody = document.getElementById('tenant-modal-body');
  
  modalBody.innerHTML = '<p>Cargando información...</p>';
  modal.style.display = 'block';
  
  try {
    // Obtener datos del tenant
    const tenantSnap = await db.collection('tenants').doc(tenantCode).get();
    if (!tenantSnap.exists) {
      modalBody.innerHTML = '<p>Error: Tenant no encontrado</p>';
      return;
    }
    const tenantData = tenantSnap.data();
    
    // Obtener usuario asociado
    const usersSnapshot = await db.collection('users').where('tenantCode', '==', tenantCode).get();
    let userData = null;
    let userEmail = 'No asignado';
    let userId = null;
    
    if (!usersSnapshot.empty) {
      const userDoc = usersSnapshot.docs[0];
      userData = userDoc.data();
      userEmail = userData.email || 'No disponible';
      userId = userDoc.id;
    }
    
    // Obtener estadísticas del tenant
    let loansCount = 0;
    let movimientosCount = 0;
    
    try {
      const loansSnapshot = await db.collection('tenants').doc(tenantCode).collection('loans').get();
      loansCount = loansSnapshot.size;
      
      const movimientosSnapshot = await db.collection('tenants').doc(tenantCode).collection('movimientos').get();
      movimientosCount = movimientosSnapshot.size;
    } catch (err) {
      console.warn('Error al obtener estadísticas:', err);
    }
    
    const createdAt = tenantData.createdAt?.toDate?.() || new Date();
    
    modalBody.innerHTML = `
      <div class="tenant-details-grid">
        <div class="tenant-detail-item">
          <label>Código Tenant</label>
          <div class="value">${tenantCode}</div>
        </div>
        <div class="tenant-detail-item">
          <label>Estado</label>
          <div class="value">
            <span class="code-status ${tenantData.blocked ? 'blocked' : (tenantData.assigned ? 'assigned' : 'available')}">
              ${tenantData.blocked ? 'Bloqueado' : (tenantData.assigned ? 'Asignado' : 'Disponible')}
            </span>
          </div>
        </div>
        <div class="tenant-detail-item">
          <label>Email del Usuario</label>
          <div class="value">${userEmail}</div>
        </div>
        ${userId ? `
          <div class="tenant-detail-item">
            <label>ID de Usuario</label>
            <div class="value" style="font-size:0.85em;word-break:break-all;">${userId}</div>
          </div>
        ` : ''}
        <div class="tenant-detail-item">
          <label>Fecha de Creación</label>
          <div class="value">${createdAt.toLocaleDateString('es-PE', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}</div>
        </div>
      </div>
      
      <div class="tenant-stats">
        <div class="tenant-stat">
          <div class="tenant-stat-value">${loansCount}</div>
          <div class="tenant-stat-label">Préstamos</div>
        </div>
        <div class="tenant-stat">
          <div class="tenant-stat-value">${movimientosCount}</div>
          <div class="tenant-stat-label">Movimientos</div>
        </div>
      </div>
      
      <div class="tenant-actions">
        <button class="main-action-btn secondary" onclick="copyToClipboard('${tenantCode}')">
          📋 Copiar Código
        </button>
        <button class="code-btn block" onclick="toggleBlockFromModal('${tenantCode}', ${tenantData.blocked})">
          ${tenantData.blocked ? '🔓 Desbloquear' : '🔒 Bloquear'}
        </button>
        ${userData ? `
          <button class="code-btn delete" onclick="deleteTenantAccount('${tenantCode}', '${userId}')">
            🗑️ Eliminar Cuenta
          </button>
        ` : ''}
      </div>
    `;
  } catch (error) {
    console.error('Error al cargar detalles:', error);
    modalBody.innerHTML = '<p>Error al cargar la información del tenant</p>';
  }
}

async function toggleBlockCode(tenantCode, block) {
  if (!confirm(block ? '¿Está seguro de bloquear este código?' : '¿Está seguro de desbloquear este código?')) {
    return;
  }
  
  try {
    await db.collection('tenants').doc(tenantCode).update({ blocked: block });
    loadCodes();
    loadStats();
    alert(block ? 'Código bloqueado' : 'Código desbloqueado');
  } catch (error) {
    alert('Error al cambiar el estado del código');
    console.error(error);
  }
}

async function toggleBlockFromModal(tenantCode, currentlyBlocked) {
  await toggleBlockCode(tenantCode, !currentlyBlocked);
  showTenantDetails(tenantCode); // Recargar detalles
}

async function deleteCode(tenantCode) {
  if (!confirm('¿Está seguro de eliminar este código? Esta acción es irreversible.')) {
    return;
  }
  
  try {
    const tenantSnap = await db.collection('tenants').doc(tenantCode).get();
    if (tenantSnap.exists && tenantSnap.data().assigned) {
      alert('No se puede eliminar un código que está asignado. Primero debe eliminar la cuenta del usuario.');
      return;
    }
    
    await db.collection('tenants').doc(tenantCode).delete();
    loadCodes();
    loadStats();
    alert('Código eliminado');
  } catch (error) {
    alert('Error al eliminar el código');
    console.error(error);
  }
}

async function deleteTenantAccount(tenantCode, userId) {
  if (!confirm('¿Está seguro de eliminar permanentemente esta cuenta y todos sus datos? Esta acción es irreversible.')) {
    return;
  }
  
  try {
    // Eliminar usuario
    await db.collection('users').doc(userId).delete();
    
    // Eliminar tenant
    await db.collection('tenants').doc(tenantCode).delete();
    
    // Eliminar colecciones del tenant
    const collections = ['loans', 'movimientos'];
    for (const col of collections) {
      const snap = await db.collection('tenants').doc(tenantCode).collection(col).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
    
    alert('Cuenta eliminada completamente');
    document.getElementById('tenant-modal').style.display = 'none';
    loadCodes();
    loadStats();
  } catch (error) {
    alert('Error al eliminar la cuenta');
    console.error(error);
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert(`Código "${text}" copiado al portapapeles`);
  }).catch(err => {
    // Fallback para navegadores antiguos
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      alert(`Código "${text}" copiado al portapapeles`);
    } catch (err) {
      alert('Error al copiar el código');
    }
    document.body.removeChild(textarea);
  });
}

async function loadGlobalUsage() {
  const usageDiv = document.getElementById('global-usage');
  const today = new Date().toISOString().slice(0, 10);
  const usageRef = db.collection('admin').doc('dailyUsage');

  try {
    const doc = await usageRef.get();
    let data = doc.exists ? doc.data() : { date: today, reads: 0, writes: 0, deletes: 0 };

    if (data.date !== today) {
      data = { date: today, reads: 0, writes: 0, deletes: 0 };
      await usageRef.set(data);
    }

    const readP = Math.min(((data.reads || 0) / 50000) * 100, 100);
    const writeP = Math.min(((data.writes || 0) / 20000) * 100, 100);
    const deleteP = Math.min(((data.deletes || 0) / 20000) * 100, 100);

    usageDiv.innerHTML = `
      <h3>Consumo Diario Global (Plan Spark)</h3>
      <div class="usage-bar">
        <div class="usage-bar-label">
          <span>Lecturas</span>
          <span>${(data.reads || 0).toLocaleString()}/50,000</span>
        </div>
        <div class="usage-bar-container">
          <div class="usage-bar-fill reads" style="width:${readP}%">
            ${readP > 10 ? Math.round(readP) + '%' : ''}
          </div>
        </div>
      </div>
      <div class="usage-bar">
        <div class="usage-bar-label">
          <span>Escrituras</span>
          <span>${(data.writes || 0).toLocaleString()}/20,000</span>
        </div>
        <div class="usage-bar-container">
          <div class="usage-bar-fill writes" style="width:${writeP}%">
            ${writeP > 10 ? Math.round(writeP) + '%' : ''}
          </div>
        </div>
      </div>
      <div class="usage-bar">
        <div class="usage-bar-label">
          <span>Eliminaciones</span>
          <span>${(data.deletes || 0).toLocaleString()}/20,000</span>
        </div>
        <div class="usage-bar-container">
          <div class="usage-bar-fill deletes" style="width:${deleteP}%">
            ${deleteP > 10 ? Math.round(deleteP) + '%' : ''}
          </div>
        </div>
      </div>
      <div class="usage-note">
        Contador centralizado actualizado en tiempo real. Última actualización: ${new Date().toLocaleTimeString('es-PE')}
      </div>
    `;
  } catch (err) {
    usageDiv.innerHTML = '<p>Error al cargar consumo global.</p>';
    console.error(err);
  }
}

// Funciones globales para usar desde onclick en el modal
window.toggleBlockFromModal = toggleBlockFromModal;
window.deleteTenantAccount = deleteTenantAccount;
window.copyToClipboard = copyToClipboard;
