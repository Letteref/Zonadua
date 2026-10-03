/**
 * The one place the app decides what an icon looks like.
 *
 * Hugeicons, not Lucide. Both are 24px-viewBox stroke outlines, so sizes and stroke widths
 * carry over unchanged — but Hugeicons is the set this project now ships: its geometry is
 * drawn for a 1.5 stroke, it exposes per-icon subpath modules (so the bundler pulls in the
 * 53 icons below rather than the 12,145 the package holds), and it is MIT like
 * the rest of the dependency set.
 *
 * Icons are addressed by kebab-case name instead of by import. That is not a new idea here:
 * `CircleButton` and `StatusChip` already took their own `icon` prop as a name. Extending it
 * keeps fifty-odd import statements out of the route files and puts the entire icon inventory
 * on one screen, where a reader can check it instead of hunting fourteen files.
 *
 * `strokeWidth` is a viewBox-unit value exactly as in Lucide, so 1.8 still means the same
 * thickness. Hugeicons bakes 1.5 into each path; `Icon.svelte` always passes the prop, which
 * is what makes that override happen.
 */
import type { IconSvgElement } from '@hugeicons/svelte';

import Activity01Icon from '@hugeicons/core-free-icons/Activity01Icon';
import Alert02Icon from '@hugeicons/core-free-icons/Alert02Icon';
import ArrowUpRight01Icon from '@hugeicons/core-free-icons/ArrowUpRight01Icon';
import Backpack01Icon from '@hugeicons/core-free-icons/Backpack01Icon';
import BellIcon from '@hugeicons/core-free-icons/BellIcon';
import Bicycle01Icon from '@hugeicons/core-free-icons/Bicycle01Icon';
import Calendar03Icon from '@hugeicons/core-free-icons/Calendar03Icon';
import AnalyticsUpIcon from '@hugeicons/core-free-icons/AnalyticsUpIcon';
import CheckIcon from '@hugeicons/core-free-icons/CheckIcon';
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import ChevronLeftIcon from '@hugeicons/core-free-icons/ChevronLeftIcon';
import ChevronRightIcon from '@hugeicons/core-free-icons/ChevronRightIcon';
import Clock01Icon from '@hugeicons/core-free-icons/Clock01Icon';
import SunCloud01Icon from '@hugeicons/core-free-icons/SunCloud01Icon';
import Coffee02Icon from '@hugeicons/core-free-icons/Coffee02Icon';
import DatabaseBackupIcon from '@hugeicons/core-free-icons/DatabaseBackupIcon';
import Download01Icon from '@hugeicons/core-free-icons/Download01Icon';
import FileUploadIcon from '@hugeicons/core-free-icons/FileUploadIcon';
import Flag01Icon from '@hugeicons/core-free-icons/Flag01Icon';
import GaugeIcon from '@hugeicons/core-free-icons/GaugeIcon';
import HeartIcon from '@hugeicons/core-free-icons/HeartIcon';
import KeyRoundIcon from '@hugeicons/core-free-icons/KeyRoundIcon';
import Loading03Icon from '@hugeicons/core-free-icons/Loading03Icon';
import LockIcon from '@hugeicons/core-free-icons/LockIcon';
import Luggage01Icon from '@hugeicons/core-free-icons/Luggage01Icon';
import MapIcon from '@hugeicons/core-free-icons/MapIcon';
import Chat01Icon from '@hugeicons/core-free-icons/Chat01Icon';
import MinusIcon from '@hugeicons/core-free-icons/MinusIcon';
import MountainIcon from '@hugeicons/core-free-icons/MountainIcon';
import OctagonAlertIcon from '@hugeicons/core-free-icons/OctagonAlertIcon';
import Edit02Icon from '@hugeicons/core-free-icons/Edit02Icon';
import PlugIcon from '@hugeicons/core-free-icons/PlugIcon';
import PlusSignIcon from '@hugeicons/core-free-icons/PlusSignIcon';
import Refresh01Icon from '@hugeicons/core-free-icons/Refresh01Icon';
import Rotate01Icon from '@hugeicons/core-free-icons/Rotate01Icon';
import Route01Icon from '@hugeicons/core-free-icons/Route01Icon';
import RulerIcon from '@hugeicons/core-free-icons/RulerIcon';
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon';
import SendIcon from '@hugeicons/core-free-icons/SendIcon';
import Settings01Icon from '@hugeicons/core-free-icons/Settings01Icon';
import Share01Icon from '@hugeicons/core-free-icons/Share01Icon';
import ShieldAlertIcon from '@hugeicons/core-free-icons/ShieldAlertIcon';
import SparklesIcon from '@hugeicons/core-free-icons/SparklesIcon';
import Sun01Icon from '@hugeicons/core-free-icons/Sun01Icon';
import Timer01Icon from '@hugeicons/core-free-icons/Timer01Icon';
import Delete01Icon from '@hugeicons/core-free-icons/Delete01Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
import Upload01Icon from '@hugeicons/core-free-icons/Upload01Icon';
import UserIcon from '@hugeicons/core-free-icons/UserIcon';
import Wrench01Icon from '@hugeicons/core-free-icons/Wrench01Icon';
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon';
import ZapIcon from '@hugeicons/core-free-icons/ZapIcon';

/**
 * App icon name -> Hugeicons geometry.
 *
 * 'alert-triangle' and 'triangle-alert' deliberately share one glyph. Lucide shipped them as
 * aliases of a single triangle, so giving them separate shapes here would invent a distinction
 * the previous icon set never had either.
 */
export const ICONS = {
  'activity': Activity01Icon,
  'alert-triangle': Alert02Icon,
  'arrow-up-right': ArrowUpRight01Icon,
  'backpack': Backpack01Icon,
  'bell': BellIcon,
  'bike': Bicycle01Icon,
  'calendar': Calendar03Icon,
  'chart-line': AnalyticsUpIcon,
  'check': CheckIcon,
  'check-circle': CheckmarkCircle02Icon,
  'chevron-left': ChevronLeftIcon,
  'chevron-right': ChevronRightIcon,
  'clock': Clock01Icon,
  'cloud-sun': SunCloud01Icon,
  'coffee': Coffee02Icon,
  'database-backup': DatabaseBackupIcon,
  'download': Download01Icon,
  'file-up': FileUploadIcon,
  'flag': Flag01Icon,
  'gauge': GaugeIcon,
  'heart': HeartIcon,
  'key-round': KeyRoundIcon,
  'loader-circle': Loading03Icon,
  'lock': LockIcon,
  'luggage': Luggage01Icon,
  'map': MapIcon,
  'message-circle': Chat01Icon,
  'minus': MinusIcon,
  'mountain': MountainIcon,
  'octagon-alert': OctagonAlertIcon,
  'pencil': Edit02Icon,
  'plug': PlugIcon,
  'plus': PlusSignIcon,
  'refresh-cw': Refresh01Icon,
  'rotate-ccw': Rotate01Icon,
  'route': Route01Icon,
  'ruler': RulerIcon,
  'search': Search01Icon,
  'send': SendIcon,
  'settings': Settings01Icon,
  'share-2': Share01Icon,
  'shield-alert': ShieldAlertIcon,
  'sparkles': SparklesIcon,
  'sun': Sun01Icon,
  'timer': Timer01Icon,
  'trash': Delete01Icon,
  'trash-2': Delete02Icon,
  'triangle-alert': Alert02Icon,
  'upload': Upload01Icon,
  'user': UserIcon,
  'wrench': Wrench01Icon,
  'x': Cancel01Icon,
  'zap': ZapIcon,
} satisfies Record<string, IconSvgElement>;

export type IconName = keyof typeof ICONS;
