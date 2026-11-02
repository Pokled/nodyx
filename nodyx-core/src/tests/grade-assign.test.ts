import { describe, it, expect, vi, beforeEach } from 'vitest'

// GradeModel.assignToMember : l'attribution d'un grade plantait TOUJOURS en 500
// (PostgreSQL 42P08 « could not determine data type of parameter $1 ») parce
// que « $1 IS NULL » ne donne aucun type au paramètre. Ces tests verrouillent
// le typage de $1 et la logique de réponse (trouvé / grade valide).

vi.mock('../config/database', () => ({ db: { query: vi.fn() }, redis: {} }))

import { db } from '../config/database'
import { assignToMember } from '../models/grade'

const COMMUNITY = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const USER      = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const GRADE     = '9b2f6a1e-0c3d-4e5f-8a7b-1c2d3e4f5a6b'

const updateSql = () => String(vi.mocked(db.query).mock.calls[0][0])

describe('assignToMember', () => {
  beforeEach(() => { vi.mocked(db.query).mockReset() })

  it('type $1 en uuid à chacun de ses usages (sinon PostgreSQL refuse la requête)', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    await assignToMember(COMMUNITY, USER, GRADE)
    const uses = updateSql().match(/\$1(?!\d)(::\w+)?/g) ?? []
    expect(uses.length).toBe(3)
    for (const u of uses) expect(u).toBe('$1::uuid')
  })

  it('attribue un grade : trouvé et valide', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    expect(await assignToMember(COMMUNITY, USER, GRADE)).toEqual({ found: true, gradeValid: true })
    expect(vi.mocked(db.query).mock.calls[0][1]).toEqual([GRADE, COMMUNITY, USER])
  })

  it('retire le grade (null) : même requête, paramètre null', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    expect(await assignToMember(COMMUNITY, USER, null)).toEqual({ found: true, gradeValid: true })
    expect(vi.mocked(db.query).mock.calls[0][1]).toEqual([null, COMMUNITY, USER])
  })

  it('grade d’une autre communauté : membre trouvé, grade invalide', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 } as never)
    expect(await assignToMember(COMMUNITY, USER, GRADE)).toEqual({ found: true, gradeValid: false })
  })

  it('membre inconnu : non trouvé', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
    expect(await assignToMember(COMMUNITY, USER, GRADE)).toEqual({ found: false, gradeValid: true })
  })
})
