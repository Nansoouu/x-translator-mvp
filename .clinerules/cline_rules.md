# 🤖 Cline Rules — x-translator-mvp

## 🎯 Objectif
Optimiser Cline pour travailler efficacement sur ce projet de traduction vidéo.

---

## 📋 Règles Générales

### Langue
- **Toujours répondre en français**
- Être direct, technique et concis
- Éviter les phrases de remplissage ("Great", "Certainly", "Okay", "Sure")

### Format de Réponse
1. **Expliquer brièvement** ce que tu vas faire
2. **Appliquer les modifications** avec les outils appropriés
3. **Utiliser `attempt_completion`** quand la tâche est terminée

### Style de Code
- Indentation : **4 espaces**
- Quotes : **double quotes** (`"`)
- Pas de trailing whitespace
- 1 ligne par déclaration import
- Espacement autour des opérateurs (`=` → ` = `, `==` → ` == `)

---

## 🐍 Backend (Python/FastAPI)

### Nommage
```python
# ✅ Bon
def calculate_total_price():
    user_id: int
    total_price: float = 0.0

# ❌ Éviter
def calculateTotalPrice():
    userId: int
    totalPrice: float = 0.0
```

### Types
```python
# ✅ Toujours typé
def process_video(url: str, language: str) -> str:
    ...

# ✅ Union types explicites
def get_user_data(user_id: int | None = None) -> dict[str, Any] | None:
    ...
```

### Async/Await
```python
# ✅ Async pour I/O
async def fetch_from_db() -> list[dict]:
    async with db_pool.acquire() as conn:
        ...

# ✅ Pas d'async inutile
def calculate_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
```

### Logging
```python
# ✅ Bon
logger = logging.getLogger(__name__)
logger.info("Processing video: %s", video_id)
logger.error("Failed to process video %s: %s", video_id, error)

# ❌ Éviter
print("Processing video...")
```

---

## ⚛️ Frontend (Next.js/TypeScript)

### Composants
```typescript
// ✅ Props typés
interface Props {
  userId: string;
  title: string;
  onAction?: () => void;
}

export default function VideoCard({ userId, title, onAction }: Props) {
  ...
}
```

### Hooks
```typescript
// ✅ Custom hooks avec types
function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  ...
}
```

### Tailwind Classes
```tsx
// ✅ Ordre cohérent
<div className="flex items-center justify-between gap-4 p-4 bg-white rounded-lg shadow-sm">
  ...
</div>
```

---

## 📁 Structure des Fichiers

### Backend
```
backend/
├── core/          # Logique métier, config, services
├── api/           # Routes FastAPI
├── tasks/         # Celery tasks
└── main.py        # Entry point
```

### Frontend
```
frontend/
├── app/           # Next.js App Router
├── components/    # Composants réutilisables
├── hooks/         # Custom hooks
├── lib/           # Utilitaires
└── messages/      # Traductions i18n
```

---

## 🔧 Workflows GitHub Actions

### Fichiers à créer
```
.github/workflows/
├── ci.yml              # Linting + tests
├── deploy-backend.yml  # Railway backend
└── deploy-frontend.yml # Railway frontend
```

### CI/CD
- Linter sur chaque push
- Tests unitaires
- Déploiement automatique sur Railway

---

## 📝 Documentation

### README.md
- Structure réelle du projet
- Commandes exactes
- Guide de déploiement
- Variables d'environnement

### .env.example
- Tous les env vars nécessaires
- Commentaires explicatifs
- Ne pas inclure de secrets réels

---

## 🚀 Scripts Utilitaires

### À créer
- `scripts/setup-dev.sh` - Installation complète
- `scripts/lint.sh` - Linting backend + frontend
- `scripts/test.sh` - Lancer les tests
- `scripts/deploy.sh` - Déploiement Railway

---

## ⚠️ Sécurité

### Ne jamais
- Committer `.env` ou `.env.local`
- Hardcoder des secrets
- Exposer des clés API

### Toujours
- Utiliser `.env` pour les secrets
- Ajouter aux `.clineignore`
- Utiliser `os.getenv()` en backend

---

## 🎨 Design & UX

### Principes
- Minimaliste et professionnel
- Responsive (mobile first)
- Accessibilité (ARIA, contrastes)
- Performance (lazy loading, code splitting)

### Composants
- Réutilisables
- Typés
- Documentés
- Testés (si possible)

---

## 🧪 Tests

### Backend
```python
# pytest + pytest-asyncio
async def test_process_video():
    result = await process_video("test_url", "fr")
    assert result.status == "completed"
```

### Frontend
```typescript
// Vitest + React Testing Library
describe('VideoCard', () => {
  it('displays video title', () => {
    render(<VideoCard title="Test" />);
    expect(screen.getByText('Test')).toBeInTheDocument();
  });
});
```

---

## 📦 Déploiement

### Railway
- Backend API + Worker séparés
- Frontend standalone
- Redis pour Celery

### Docker (optionnel)
- `docker-compose.yml` pour dev
- `docker-compose.prod.yml` pour prod

---

## ✅ Checklist Avant Commit

- [ ] Code formaté (black + prettier)
- [ ] Types complets
- [ ] Pas de console.log en prod
- [ ] Env vars sécurisés
- [ ] README à jour si nécessaire
- [ ] Tests écrits (si applicable)

---

**Cline, suis ces règles pour un travail optimal sur ce projet.**