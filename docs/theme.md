# Underwater Dream

Client and admin app theme. It follows `prefers-color-scheme` by default;
the user can pick light, dark or system in Account (saved in `localStorage`).

| Color token              | Light     | Dark      | Used for                                |
| ------------------------ | --------- | --------- | --------------------------------------- |
| `--background`           | `#DBE9EE` | `#101D24` | Page                                    |
| `--surface`              | `#FFFFFF` | `#192C36` | Cards, dialogs, menus, inputs           |
| `--foreground`           | `#203844` | `#E6F1F5` | Text                                    |
| `--muted-foreground`     | `#476471` | `#B2C8D1` | Secondary text                          |
| `--primary`              | `#166088` | `#92CBE6` | Main buttons, links                     |
| `--primary-foreground`   | `#FFFFFF` | `#102530` | Text on primary                         |
| `--secondary`            | `#C0D6DF` | `#2A414D` | Secondary buttons, hover, muted areas   |
| `--secondary-foreground` | `#294652` | `#DBE9EE` | Text on secondary                       |
| `--border`               | `#B6CBD4` | `#405965` | Dividers, card edges                    |
| `--input`                | `#738E9B` | `#64808D` | Form control borders (≥ 3:1 on surface) |
| `--ring`                 | `#166088` | `#AADAF0` | Focus ring                              |
| `--status-online`        | `#146847` | `#79DEB2` | 🟢 `ONLINE`, recovery                   |
| `--status-offline`       | `#A43042` | `#FFA0AC` | 🔴 `OFFLINE`, open outage               |
| `--status-pending`       | `#56657A` | `#A5B4CA` | ⚪ `PENDING`, `UPDATING`, unknown cause |
| `--danger`               | `#A43042` | `#FFA0AC` | Destructive actions, errors             |
| `--danger-foreground`    | `#FFFFFF` | `#102530` | Text on danger                          |
| `--warning`              | `#855A12` | `#F1C677` | Power blips, settings not yet applied   |

## shadcn/ui mapping

`card`, `popover` → `surface` (foreground → `foreground`) · `muted`, `accent`
→ `secondary` · `muted-foreground` → `muted-foreground` · `destructive` →
`danger` · `input`, `ring`, `border` as above.

## Contrast

Every text token is at least 4.5:1 on `--background` and `--surface` in both
modes. Status and warning text is placed on `--surface` or `--background`,
not on `--secondary` (light `--warning` is 4.0:1 there).
