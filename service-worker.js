// ==========================================
// 우리집 라이프 OS - Service Worker
// ==========================================
// 역할:
// 1. PWA로 인식되게 만들기 (필수)
// 2. 오프라인 캐싱 (네트워크 끊겨도 기본 페이지는 열림)
// 3. 푸시 알림 수신 (2단계에서 추가됨)

const CACHE_VERSION = 'lifeos-v1';
const CACHE_NAME = `${CACHE_VERSION}-static`;

// 미리 캐시할 파일 목록
const PRECACHE_URLS = [
  './',
  './index.html',
  './gagebu.html',
  './travel.html',
  './kids.html',
  './home.html',
  './health.html',
  './maintenance.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

// 설치: 정적 파일 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // 일부 파일이 없어도 실패하지 않도록 개별 처리
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(err => {
            console.warn(`[SW] Failed to cache ${url}:`, err.message);
          }))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// 활성화: 옛날 캐시 청소
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 요청 처리: 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', (event) => {
  // GET 요청만 처리
  if (event.request.method !== 'GET') return;
  
  // Firebase, 외부 API 등은 캐시 안함 (실시간성 중요)
  const url = new URL(event.request.url);
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebase.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('cloudfunctions.net') ||
    url.hostname.includes('kakao.com') ||
    url.hostname.includes('generativelanguage') ||
    url.pathname.startsWith('/__/')
  ) {
    return; // 브라우저 기본 처리
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 성공한 응답만 캐시 업데이트 (정적 자원만)
        if (response && response.status === 200 && response.type === 'basic') {
          const respClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, respClone).catch(() => {});
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 → 캐시에서 찾기
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) return cachedResponse;
          // 캐시도 없고 HTML 요청이면 index.html 반환
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./index.html');
          }
          return new Response('오프라인 상태입니다', { status: 503 });
        });
      })
  );
});

// 메시지 핸들러 (앱에서 SW에게 명령 가능)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 푸시 알림 수신 (2단계에서 본격 구현 예정)
// 일단 placeholder만 — Firebase Messaging은 firebase-messaging-sw.js에서 별도 처리
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 이미 라이프OS 탭 열려있으면 그걸로 포커스
      for (const client of windowClients) {
        if (client.url.includes('/lifeos/') && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // 없으면 새 창
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
