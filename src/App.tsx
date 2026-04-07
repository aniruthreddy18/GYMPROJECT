import React, { useState, useEffect, useMemo, Component } from 'react';
import { 
  Users, 
  CreditCard, 
  Bell, 
  Plus, 
  Trash2, 
  CheckCircle, 
  AlertCircle, 
  TrendingUp,
  LayoutDashboard,
  UserPlus,
  History,
  Search,
  Phone,
  Calendar,
  Settings,
  Save,
  Download,
  Edit2,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  X,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO, addMonths, startOfMonth, endOfMonth, addDays } from 'date-fns';
import { 
  auth, db, googleProvider, signInWithPopup, onAuthStateChanged, 
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, 
  query, where, onSnapshot, orderBy, limit, writeBatch, handleFirestoreError, OperationType, getCountFromServer, startAfter, limitToLast, type User
} from './firebase';

import { QRCodeSVG } from 'qrcode.react';

// --- Types ---
interface StatusChange {
  status: string;
  date: string;
}

interface Member {
  id: string;
  name: string;
  phone: string;
  join_date: string;
  plan: string;
  fee_amount: number;
  status: string;
  status_history?: StatusChange[];
}

interface Payment {
  id: string;
  member_id: string;
  name: string;
  amount: number;
  payment_date: string | null;
  due_date: string;
  status: string;
  last_reminder_date?: string | null;
  method?: string;
}

interface DashboardStats {
  totalMembers: number;
  pendingCount: number;
  paidCount: number;
  monthlyRevenue: number;
  recentPending: (Payment & { phone: string })[];
}

interface AutomationLog {
  id: string;
  type: string;
  member_name: string;
  phone: string;
  message: string;
  timestamp: any;
  status: string;
}

interface AppSettings {
  reminder_days_before: string;
  overdue_reminder_frequency: string;
  upcoming_message: string;
  overdue_message: string;
  whatsapp_webhook_url?: string;
  upi_id?: string;
}

// --- Components ---

const StatCard = ({ title, value, icon: Icon, color, onClick }: any) => (
  <div 
    onClick={onClick}
    className={`bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 transition-all relative overflow-hidden group ${onClick ? 'cursor-pointer hover:shadow-xl hover:-translate-y-1 active:scale-95 touch-manipulation' : ''}`}
  >
    <div className={`p-3 md:p-4 rounded-xl md:rounded-2xl ${color} shadow-lg shadow-indigo-100 relative z-10`}>
      <Icon className="w-5 h-5 md:w-6 md:h-6 text-white" />
    </div>
    <div className="relative z-10">
      <p className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-wider mb-0.5 md:mb-1">{title}</p>
      <h3 className="text-xl md:text-2xl font-black text-gray-900 leading-none">{value}</h3>
    </div>
    <div className={`absolute -right-4 -bottom-4 w-20 h-20 md:w-24 md:h-24 rounded-full opacity-5 group-hover:scale-150 transition-transform duration-500 ${color}`} />
  </div>
);

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<any, any> {
  state = { hasError: false, error: null };
  props: any;

  constructor(props: any) {
    super(props);
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error && parsed.error.includes("permission-denied")) {
          errorMessage = "You don't have permission to access this data. Please ensure you are logged in as an admin.";
        }
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-red-100">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Application Error</h2>
            <p className="text-gray-600 mb-8 leading-relaxed">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<'dashboard' | 'members' | 'payments' | 'settings'>('dashboard');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [isEditingMember, setIsEditingMember] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [selectedMemberForHistory, setSelectedMemberForHistory] = useState<Member | null>(null);
  const [memberHistory, setMemberHistory] = useState<Payment[]>([]);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isRunningAutomation, setIsRunningAutomation] = useState(false);
  const [isSeedingData, setIsSeedingData] = useState(false);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'paid' | 'pending'>('all');
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ title: string, message: string, onConfirm: () => void } | null>(null);

  // Pagination State
  const [membersPage, setMembersPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [membersPageSize] = useState(10);
  const [paymentsPageSize] = useState(10);
  const [totalMembersCount, setTotalMembersCount] = useState(0);
  const [totalPaymentsCount, setTotalPaymentsCount] = useState(0);
  const [membersCursors, setMembersCursors] = useState<any[]>([null]);
  const [paymentsCursors, setPaymentsCursors] = useState<any[]>([null]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const isValidIndianPhone = (phone: string) => /^91\d{10}$/.test(phone);
  const [selectedPayments, setSelectedPayments] = useState<string[]>([]);
  const [sortField, setSortField] = useState<'due_date' | 'amount' | 'status' | 'name'>('due_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [paymentModal, setPaymentModal] = useState<{ isOpen: boolean, payment: Payment | null }>({ isOpen: false, payment: null });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setIsAuthReady(true);
      
      if (user) {
        // Initialize user document if it doesn't exist
        try {
          const userRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              role: 'admin',
              email: user.email,
              displayName: user.displayName,
              createdAt: new Date().toISOString()
            });
          }
        } catch (err) {
          console.error("Error initializing user document:", err);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const [automationLogs, setAutomationLogs] = useState<AutomationLog[]>([]);

  useEffect(() => {
    if (!isAuthReady || !user) return;
    
    const unsubLogs = onSnapshot(
      query(collection(db, 'users', user.uid, 'automation_logs'), orderBy('timestamp', 'desc'), limit(10)),
      (snapshot) => {
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AutomationLog));
        setAutomationLogs(logs);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/automation_logs`)
    );
    
    return () => unsubLogs();
  }, [isAuthReady, user]);

  // Fetch Counts and Stats
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const fetchCounts = async () => {
      try {
        const membersColl = collection(db, 'users', user.uid, 'members');
        const paymentsColl = collection(db, 'users', user.uid, 'payments');
        
        const membersCountSnap = await getCountFromServer(membersColl);
        setTotalMembersCount(membersCountSnap.data().count);

        const paymentsCountSnap = await getCountFromServer(paymentsColl);
        setTotalPaymentsCount(paymentsCountSnap.data().count);

        // Fetch current month payments for accurate dashboard stats
        const now = new Date();
        const start = startOfMonth(now).toISOString().split('T')[0];
        const end = endOfMonth(now).toISOString().split('T')[0];
        
        // 1. Fetch ALL pending payments to include overdue ones from previous months
        const pendingQuery = query(paymentsColl, where('status', '==', 'pending'));
        const pendingSnap = await getDocs(pendingQuery);
        const allPending = pendingSnap.docs.map(d => ({ id: d.id, ...d.data() } as Payment));
        
        // 2. Fetch paid payments for THIS month for revenue and paid count
        // We use payment_date to track when money actually came in
        const paidQuery = query(
          paymentsColl, 
          where('status', '==', 'paid'),
          where('payment_date', '>=', start),
          where('payment_date', '<=', end)
        );
        
        let paidPayments: Payment[] = [];
        try {
          const paidSnap = await getDocs(paidQuery);
          paidPayments = paidSnap.docs.map(d => ({ id: d.id, ...d.data() } as Payment));
        } catch (indexError) {
          // Fallback if index is missing: fetch all paid and filter
          console.warn("Paid query failed, falling back to client-side filter.");
          const fallbackQuery = query(paymentsColl, where('status', '==', 'paid'));
          const fallbackSnap = await getDocs(fallbackQuery);
          paidPayments = fallbackSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as Payment))
            .filter(p => p.payment_date && p.payment_date >= start && p.payment_date <= end);
        }
        
        const revenue = paidPayments.reduce((acc, p) => acc + p.amount, 0);

        // Sort pending by due date (oldest first)
        const sortedPending = allPending
          .sort((a, b) => parseISO(a.due_date).getTime() - parseISO(b.due_date).getTime());
        
        const recentPendingRaw = sortedPending.slice(0, 10); // Show up to 10 on dashboard
        
        const recentPendingWithNames = await Promise.all(recentPendingRaw.map(async (p) => {
          try {
            const mSnap = await getDoc(doc(db, 'users', user.uid, 'members', p.member_id));
            if (mSnap.exists()) {
              const mData = mSnap.data();
              return { ...p, name: mData.name, phone: mData.phone };
            }
          } catch (e) {
            console.error("Error fetching member for recent pending:", e);
          }
          return { ...p, name: 'Unknown', phone: '' };
        }));
        
        setStats({
          totalMembers: membersCountSnap.data().count,
          pendingCount: allPending.length,
          paidCount: paidPayments.length,
          monthlyRevenue: revenue,
          recentPending: recentPendingWithNames
        });

      } catch (err) {
        console.error("Error fetching counts:", err);
      }
    };

    fetchCounts();
    // Refresh counts every 5 minutes or on demand
    const interval = setInterval(fetchCounts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthReady, user]);

  useEffect(() => {
    if (!isAuthReady || !user) return;

    const membersColl = collection(db, 'users', user.uid, 'members');
    let q = query(membersColl, orderBy('name'), limit(membersPageSize));
    
    if (membersPage > 1 && membersCursors[membersPage - 1]) {
      q = query(membersColl, orderBy('name'), startAfter(membersCursors[membersPage - 1]), limit(membersPageSize));
    }

    const unsubMembers = onSnapshot(q, (snapshot) => {
      const membersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member));
      setMembers(membersData);
      
      // Update names cache
      setMemberNames(prev => {
        const next = { ...prev };
        membersData.forEach(m => {
          next[m.id] = m.name;
        });
        return next;
      });
      
      // Update cursor for next page if we are on the current page
      if (snapshot.docs.length > 0) {
        const lastDoc = snapshot.docs[snapshot.docs.length - 1];
        setMembersCursors(prev => {
          const next = [...prev];
          next[membersPage] = lastDoc;
          return next;
        });
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/members`));

    // Listen to Payments (Paginated)
    const paymentsColl = collection(db, 'users', user.uid, 'payments');
    let pq = query(paymentsColl, orderBy('due_date', 'desc'), limit(paymentsPageSize));

    if (paymentsPage > 1 && paymentsCursors[paymentsPage - 1]) {
      pq = query(paymentsColl, orderBy('due_date', 'desc'), startAfter(paymentsCursors[paymentsPage - 1]), limit(paymentsPageSize));
    }

    const unsubPayments = onSnapshot(pq, (snapshot) => {
      const paymentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setPayments(paymentsData);

      if (snapshot.docs.length > 0) {
        const lastDoc = snapshot.docs[snapshot.docs.length - 1];
        setPaymentsCursors(prev => {
          const next = [...prev];
          next[paymentsPage] = lastDoc;
          return next;
        });
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/payments`));

    // Listen to Settings
    const unsubSettings = onSnapshot(doc(db, 'users', user.uid, 'settings', 'config'), (docSnap) => {
      if (docSnap.exists()) {
        setSettings(docSnap.data() as AppSettings);
      } else {
        // Initialize default settings
        const defaultSettings = {
          reminder_days_before: '2',
          overdue_reminder_frequency: '2',
          upcoming_message: 'the payment for the next month is in next {days} days try to pay as soon as possible',
          overdue_message: 'payment of gym fees is pending pay as soon as possible',
          whatsapp_webhook_url: ''
        };
        setDoc(doc(db, 'users', user.uid, 'settings', 'config'), defaultSettings);
        setSettings(defaultSettings);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}/settings/config`));

    return () => {
      unsubMembers();
      unsubPayments();
      unsubSettings();
    };
  }, [isAuthReady, user, membersPage, paymentsPage]);

  const enrichedPayments = useMemo(() => {
    return payments.map(p => {
      const member = members.find(m => m.id === p.member_id);
      return { ...p, name: member?.name || memberNames[p.member_id] || 'Loading...' };
    });
  }, [payments, members, memberNames]);

  // Effect to fetch missing member names for payments
  useEffect(() => {
    if (!isAuthReady || !user || !payments.length) return;

    const fetchMissingNames = async () => {
      const missingIds = payments
        .map(p => p.member_id)
        .filter(id => !memberNames[id]);
      
      if (missingIds.length === 0) return;

      const uniqueMissing = Array.from(new Set(missingIds)) as string[];
      const newNames: Record<string, string> = {};

      await Promise.all(uniqueMissing.map(async (id: string) => {
        try {
          const mSnap = await getDoc(doc(db, 'users', user.uid, 'members', id));
          if (mSnap.exists()) {
            newNames[id] = mSnap.data().name;
          }
        } catch (e) {
          console.error("Error fetching missing member name:", e);
        }
      }));

      if (Object.keys(newNames).length > 0) {
        setMemberNames(prev => ({ ...prev, ...newNames }));
      }
    };

    fetchMissingNames();
  }, [payments, isAuthReady, user]);

  const filteredPayments = useMemo(() => {
    const today = new Date();
    const start = startOfMonth(today);
    const end = endOfMonth(today);

    const filtered = enrichedPayments.filter(p => {
      const statusMatch = paymentStatusFilter === 'all' || p.status === paymentStatusFilter;
      if (!statusMatch) return false;
      
      const dueDate = parseISO(p.due_date);
      
      // If it's pending, show it regardless of date (to include overdue)
      if (p.status === 'pending') return true;
      
      // If it's paid, only show it if it was paid this month or due this month
      // This keeps the list manageable
      return (dueDate >= start && dueDate <= end) || 
             (p.payment_date && parseISO(p.payment_date) >= start && parseISO(p.payment_date) <= end);
    });
    
    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'due_date') {
        comparison = parseISO(a.due_date).getTime() - parseISO(b.due_date).getTime();
      } else if (sortField === 'amount') {
        comparison = a.amount - b.amount;
      } else if (sortField === 'status') {
        comparison = a.status.localeCompare(b.status);
      } else if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [enrichedPayments, paymentStatusFilter, sortField, sortOrder]);

  const handleSort = (field: 'due_date' | 'amount' | 'status' | 'name') => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const pendingPaymentsForBulk = useMemo(() => {
    return enrichedPayments.filter(p => p.status === 'pending' && (paymentStatusFilter === 'all' || paymentStatusFilter === 'pending'));
  }, [enrichedPayments, paymentStatusFilter]);
  const [newMember, setNewMember] = useState({
    name: '',
    phone: '',
    join_date: format(new Date(), 'yyyy-MM-dd'),
    plan: 'monthly',
    fee_amount: 1000
  });

  const handleNextMembers = () => {
    if (members.length === membersPageSize) {
      setMembersPage(prev => prev + 1);
    }
  };

  const handlePrevMembers = () => {
    setMembersPage(prev => Math.max(1, prev - 1));
  };

  const handleNextPayments = () => {
    if (payments.length === paymentsPageSize) {
      setPaymentsPage(prev => prev + 1);
    }
  };

  const handlePrevPayments = () => {
    setPaymentsPage(prev => Math.max(1, prev - 1));
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidIndianPhone(newMember.phone)) {
      showNotification("Please enter a valid Indian phone number starting with 91 followed by 10 digits (e.g., 919876543210)", 'error');
      return;
    }
    if (!user) return;

    // Check for duplicate phone number
    const duplicate = members.find(m => m.phone === newMember.phone);
    if (duplicate) {
      showNotification(`A member with phone number ${newMember.phone} already exists (${duplicate.name})`, 'error');
      return;
    }

    try {
      const memberRef = doc(collection(db, 'users', user.uid, 'members'));
      const memberId = memberRef.id;
      const memberData = { 
        ...newMember, 
        status: 'active',
        status_history: [{ status: 'active', date: newMember.join_date }]
      };
      
      await setDoc(memberRef, memberData);

      // 1. Mark initial payment as PAID (Joining Month)
      const initialPaymentRef = doc(collection(db, 'users', user.uid, 'payments'));
      await setDoc(initialPaymentRef, {
        member_id: memberId,
        amount: newMember.fee_amount,
        payment_date: newMember.join_date,
        due_date: newMember.join_date,
        status: 'paid'
      });

      // 2. Create NEXT payment record as PENDING
      let monthsToAdd = 1;
      if (newMember.plan === 'quarterly') monthsToAdd = 3;
      if (newMember.plan === 'yearly') monthsToAdd = 12;
      
      const nextDueDate = format(addMonths(parseISO(newMember.join_date), monthsToAdd), 'yyyy-MM-dd');
      const nextPaymentRef = doc(collection(db, 'users', user.uid, 'payments'));
      await setDoc(nextPaymentRef, {
        member_id: memberId,
        amount: newMember.fee_amount,
        due_date: nextDueDate,
        status: 'pending'
      });

      setIsAddingMember(false);
      setNewMember({
        name: '',
        phone: '',
        join_date: format(new Date(), 'yyyy-MM-dd'),
        plan: 'monthly',
        fee_amount: 1000
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'members');
    }
  };
  
  const handleEditMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    
    if (!isValidIndianPhone(editingMember.phone)) {
      showNotification("Please enter a valid Indian phone number starting with 91 followed by 10 digits (e.g., 919876543210)", 'error');
      return;
    }

    if (!user) return;
    
    // Check for duplicate phone number (excluding self)
    const duplicate = members.find(m => m.phone === editingMember.phone && m.id !== editingMember.id);
    if (duplicate) {
      showNotification(`Another member with phone number ${editingMember.phone} already exists (${duplicate.name})`, 'error');
      return;
    }

    try {
      const originalMember = members.find(m => m.id === editingMember.id);
      const { id, ...data } = editingMember;
      
      if (originalMember && originalMember.status !== data.status) {
        const newHistory = [
          ...(originalMember.status_history || []),
          { status: data.status, date: format(new Date(), 'yyyy-MM-dd') }
        ];
        data.status_history = newHistory;
      }

      await updateDoc(doc(db, 'users', user.uid, 'members', id), data);
      setIsEditingMember(false);
      setEditingMember(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/members/${editingMember.id}`);
    }
  };

  const handleWhatsAppReminder = (memberId: string, amount: number, dueDate: string) => {
    const member = members.find(m => m.id === memberId);
    if (!member) return;

    const message = settings?.upcoming_message
      ? settings.upcoming_message.replace('{days}', '2') // Defaulting to 2 for manual
      : `Hi ${member.name}, this is a reminder for your gym fee of ₹${amount} due on ${format(parseISO(dueDate), 'dd-MM-yyyy')}. Please pay as soon as possible.`;

    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${member.phone.replace(/\D/g, '')}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
  };

  const handleMarkPaid = async (id: string, method: string = 'cash') => {
    if (!user) return;
    try {
      const paymentDate = format(new Date(), 'yyyy-MM-dd');
      const paymentRef = doc(db, 'users', user.uid, 'payments', id);
      const paymentSnap = await getDoc(paymentRef);
      
      if (!paymentSnap.exists()) return;
      const paymentData = paymentSnap.data() as any;
      
      await updateDoc(paymentRef, {
        status: 'paid',
        payment_date: paymentDate,
        method: method
      });
      
      const memberSnap = await getDoc(doc(db, 'users', user.uid, 'members', paymentData.member_id));
      if (!memberSnap.exists()) return;
      const memberData = memberSnap.data() as any;
      
      let monthsToAdd = 1;
      if (memberData.plan === 'quarterly') monthsToAdd = 3;
      if (memberData.plan === 'yearly') monthsToAdd = 12;
      
      const nextDueDate = format(addMonths(parseISO(paymentData.due_date), monthsToAdd), 'yyyy-MM-dd');
      await setDoc(doc(collection(db, 'users', user.uid, 'payments')), {
        member_id: memberData.id || memberSnap.id,
        amount: memberData.fee_amount,
        due_date: nextDueDate,
        status: 'pending'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/payments/${id}`);
    }
  };

  const handleRunAutomation = async () => {
    if (!user) return;
    setIsRunningAutomation(true);
    try {
      const response = await fetch('/api/trigger-reminders', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid })
      });
      const data = await response.json();
      if (data.success) {
        showNotification(`Automation completed! Processed ${data.processedCount} reminders.`, 'success');
      } else {
        showNotification(`Automation failed: ${data.error || data.message}`, 'error');
      }
    } catch (error) {
      console.error('Error running automation:', error);
      showNotification('Error running automation. Check console.', 'error');
    } finally {
      setIsRunningAutomation(false);
    }
  };

  const handleSeedData = async () => {
    if (!user) return;
    setConfirmModal({
      title: 'Seed Test Data',
      message: 'This will add 3 test members and 3 test payments (Upcoming, Overdue, and Paid). Continue?',
      onConfirm: async () => {
        setIsSeedingData(true);
        try {
          const batch = writeBatch(db);
          const today = new Date();
          
          // Member 1: Active, Upcoming payment in 2 days
          const m1Ref = doc(collection(db, 'users', user.uid, 'members'));
          batch.set(m1Ref, {
            name: 'Test Member (Upcoming)',
            phone: '911234567890',
            join_date: format(addDays(today, -30), 'yyyy-MM-dd'),
            plan: 'monthly',
            fee_amount: 1000,
            status: 'active'
          });
          
          const p1Ref = doc(collection(db, 'users', user.uid, 'payments'));
          batch.set(p1Ref, {
            member_id: m1Ref.id,
            amount: 1000,
            due_date: format(addDays(today, 2), 'yyyy-MM-dd'),
            status: 'pending'
          });

          // Member 2: Active, Overdue payment (3 days ago)
          const m2Ref = doc(collection(db, 'users', user.uid, 'members'));
          batch.set(m2Ref, {
            name: 'Test Member (Overdue)',
            phone: '910987654321',
            join_date: format(addDays(today, -60), 'yyyy-MM-dd'),
            plan: 'monthly',
            fee_amount: 1200,
            status: 'active'
          });
          
          const p2Ref = doc(collection(db, 'users', user.uid, 'payments'));
          batch.set(p2Ref, {
            member_id: m2Ref.id,
            amount: 1200,
            due_date: format(addDays(today, -3), 'yyyy-MM-dd'),
            status: 'pending'
          });

          // Member 3: Active, Paid payment
          const m3Ref = doc(collection(db, 'users', user.uid, 'members'));
          batch.set(m3Ref, {
            name: 'Test Member (Paid)',
            phone: '915556667777',
            join_date: format(addDays(today, -15), 'yyyy-MM-dd'),
            plan: 'monthly',
            fee_amount: 800,
            status: 'active'
          });
          
          const p3Ref = doc(collection(db, 'users', user.uid, 'payments'));
          batch.set(p3Ref, {
            member_id: m3Ref.id,
            amount: 800,
            due_date: format(today, 'yyyy-MM-dd'),
            payment_date: format(today, 'yyyy-MM-dd'),
            status: 'paid'
          });

          await batch.commit();
          showNotification('Test data seeded successfully!', 'success');
        } catch (error) {
          console.error('Error seeding data:', error);
          showNotification('Error seeding data. Check console.', 'error');
        } finally {
          setIsSeedingData(false);
          setConfirmModal(null);
        }
      }
    });
  };

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings || !user) return;
    setIsSavingSettings(true);
    try {
      await setDoc(doc(db, 'users', user.uid, 'settings', 'config'), settings);
      showNotification('Settings updated successfully!', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/settings/config`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleTestWebhook = async () => {
    const rawUrl = settings?.whatsapp_webhook_url || '';
    const trimmedUrl = rawUrl.trim();
    
    if (!trimmedUrl) {
      showNotification("Please enter a webhook URL first", 'error');
      return;
    }

    const isTestUrl = trimmedUrl.includes('/webhook-test/');
    
    try {
      const response = await fetch('/api/proxy-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: trimmedUrl,
          data: {
            type: 'test_connection',
            member_name: 'Test User',
            phone: '911234567890',
            message: 'This is a test message from your Gym Management App!',
            timestamp: new Date().toISOString()
          }
        })
      });
      
      const data = await response.json();
      if (data.success) {
        showNotification("Test webhook sent successfully!", 'success');
      } else {
        // Try to extract the message from n8n's JSON response
        let n8nMessage = data.error;
        try {
          // If data.error is "HTTP 404: {...}", extract the JSON part
          const jsonPart = data.error.split(': ').slice(1).join(': ');
          const parsed = JSON.parse(jsonPart);
          if (parsed.message) n8nMessage = parsed.message;
        } catch (e) {
          // Fallback to original error string
        }

        let errorMsg = `n8n Error: ${n8nMessage}`;
        if (isTestUrl && (data.error.includes('404') || n8nMessage.includes('not registered'))) {
          errorMsg = "n8n is not listening. Click 'Execute Workflow' in n8n first!";
        }
        
        console.error(`Webhook failed for URL: ${data.attemptedUrl}`, data.error);
        showNotification(errorMsg, 'error');
      }
    } catch (error) {
      console.error('Error sending test webhook:', error);
      showNotification("Error sending test webhook. Check console.", 'error');
    }
  };

  const handleDeleteMember = async (id: string) => {
    if (!user) return;
    setConfirmModal({
      title: 'Delete Member',
      message: 'Are you sure you want to delete this member? All their payment records will also be deleted.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'users', user.uid, 'members', id));
          // Also delete their payments
          const q = query(collection(db, 'users', user.uid, 'payments'), where('member_id', '==', id));
          const pSnaps = await getDocs(q);
          const batch = writeBatch(db);
          pSnaps.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          showNotification('Member deleted successfully!', 'success');
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/members/${id}`);
        } finally {
          setConfirmModal(null);
        }
      }
    });
  };

  const handleCleanDuplicates = async () => {
    if (!user) return;
    setConfirmModal({
      title: 'Clean Duplicate Data',
      message: 'This will find members with duplicate phone numbers and duplicate payments for the same month, keeping only the most recent records. Continue?',
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          let deletedMembersCount = 0;
          let deletedPaymentsCount = 0;

          // 1. Clean Duplicate Members
          const phoneGroups: { [phone: string]: Member[] } = {};
          members.forEach(m => {
            if (!phoneGroups[m.phone]) phoneGroups[m.phone] = [];
            phoneGroups[m.phone].push(m);
          });

          for (const phone in phoneGroups) {
            const group = phoneGroups[phone];
            if (group.length > 1) {
              group.sort((a, b) => parseISO(b.join_date).getTime() - parseISO(a.join_date).getTime());
              const toDelete = group.slice(1);
              for (const m of toDelete) {
                batch.delete(doc(db, 'users', user.uid, 'members', m.id));
                const q = query(collection(db, 'users', user.uid, 'payments'), where('member_id', '==', m.id));
                const pSnaps = await getDocs(q);
                pSnaps.docs.forEach(d => batch.delete(d.ref));
                deletedMembersCount++;
              }
            }
          }

          // 2. Clean Duplicate Payments for remaining members
          const memberPaymentGroups: { [memberId: string]: { [dueDate: string]: Payment[] } } = {};
          payments.forEach(p => {
            if (!memberPaymentGroups[p.member_id]) memberPaymentGroups[p.member_id] = {};
            if (!memberPaymentGroups[p.member_id][p.due_date]) memberPaymentGroups[p.member_id][p.due_date] = [];
            memberPaymentGroups[p.member_id][p.due_date].push(p);
          });

          for (const mId in memberPaymentGroups) {
            for (const dDate in memberPaymentGroups[mId]) {
              const group = memberPaymentGroups[mId][dDate];
              if (group.length > 1) {
                // Keep the one that is 'paid' if any, otherwise keep the first one
                group.sort((a, b) => (a.status === 'paid' ? -1 : 1));
                const toDelete = group.slice(1);
                for (const p of toDelete) {
                  batch.delete(doc(db, 'users', user.uid, 'payments', p.id));
                  deletedPaymentsCount++;
                }
              }
            }
          }

          if (deletedMembersCount > 0 || deletedPaymentsCount > 0) {
            await batch.commit();
            showNotification(`Cleaned ${deletedMembersCount} duplicate members and ${deletedPaymentsCount} duplicate payments.`, 'success');
          } else {
            showNotification('No duplicate records found.', 'info');
          }
        } catch (err) {
          console.error('Error cleaning duplicates:', err);
          showNotification('Error cleaning duplicates.', 'error');
        } finally {
          setConfirmModal(null);
        }
      }
    });
  };

  const fetchMemberHistory = async (member: Member) => {
    const history = payments.filter(p => p.member_id === member.id)
      .sort((a, b) => parseISO(b.due_date).getTime() - parseISO(a.due_date).getTime());
    setMemberHistory(history);
    setSelectedMemberForHistory(member);
    setIsHistoryModalOpen(true);
  };

  const handleExportCSV = () => {
    const data = members.flatMap(m => {
      const mPayments = payments.filter(p => p.member_id === m.id);
      if (mPayments.length === 0) {
        return [{
          name: m.name, phone: m.phone, join_date: m.join_date, plan: m.plan, fee_amount: m.fee_amount, member_status: m.status,
          payment_amount: "", due_date: "", payment_date: "", payment_status: ""
        }];
      }
      return mPayments.map(p => ({
        name: m.name, phone: m.phone, join_date: m.join_date, plan: m.plan, fee_amount: m.fee_amount, member_status: m.status,
        payment_amount: p.amount, due_date: p.due_date, payment_date: p.payment_date || "", payment_status: p.status
      }));
    });

    const headers = ["Member Name", "Phone", "Join Date", "Plan", "Fee Amount", "Member Status", "Payment Amount", "Due Date", "Payment Date", "Payment Status"];
    const rows = data.map(row => [
      `"${row.name}"`, `"${row.phone}"`, row.join_date, row.plan, row.fee_amount, row.member_status,
      row.payment_amount, row.due_date, row.payment_date, row.payment_status
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'gym_members_history.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleBulkMarkPaid = async () => {
    if (selectedPayments.length === 0 || !user) return;
    
    try {
      const batch = writeBatch(db);
      const paymentDate = format(new Date(), 'yyyy-MM-dd');

      for (const id of selectedPayments) {
        const pData = payments.find(p => p.id === id);
        if (!pData) continue;

        const paymentRef = doc(db, 'users', user.uid, 'payments', id);
        batch.update(paymentRef, {
          status: 'paid',
          payment_date: paymentDate
        });

        const mData = members.find(m => m.id === pData.member_id);
        if (!mData) continue;

        let monthsToAdd = 1;
        if (mData.plan === 'quarterly') monthsToAdd = 3;
        if (mData.plan === 'yearly') monthsToAdd = 12;
        
        const nextDueDate = format(addMonths(parseISO(pData.due_date), monthsToAdd), 'yyyy-MM-dd');
        const nextPaymentRef = doc(collection(db, 'users', user.uid, 'payments'));
        batch.set(nextPaymentRef, {
          member_id: mData.id,
          amount: mData.fee_amount,
          due_date: nextDueDate,
          status: 'pending'
        });
      }
      
      await batch.commit();
      setSelectedPayments([]);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/bulk-pay`);
    }
  };

  const togglePaymentSelection = (id: string) => {
    setSelectedPayments(prev => 
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const toggleAllPayments = (ids: string[]) => {
    if (selectedPayments.length === ids.length) {
      setSelectedPayments([]);
    } else {
      setSelectedPayments(ids);
    }
  };

  const PaymentModal = () => {
    if (!paymentModal.isOpen || !paymentModal.payment) return null;
    const p = paymentModal.payment;
    const memberName = memberNames[p.member_id] || 'Unknown Member';
    
    const upiUrl = settings?.upi_id 
      ? `upi://pay?pa=${settings.upi_id}&pn=GymFlow&am=${p.amount}&cu=INR&tn=GymFee_${p.due_date}`
      : null;

    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
        >
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-indigo-600 text-white">
            <h3 className="text-xl font-bold">Collect Payment</h3>
            <button onClick={() => setPaymentModal({ isOpen: false, payment: null })} className="p-2 hover:bg-white/20 rounded-full transition-all">
              <X className="w-6 h-6" />
            </button>
          </div>
          
          <div className="p-8 space-y-6">
            <div className="text-center">
              <p className="text-sm text-gray-500 uppercase font-bold tracking-wider mb-1">Amount Due</p>
              <h2 className="text-4xl font-black text-gray-900">₹{p.amount}</h2>
              <p className="text-sm text-indigo-600 font-bold mt-2">{memberName}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => {
                  handleMarkPaid(p.id, 'cash');
                  setPaymentModal({ isOpen: false, payment: null });
                  showNotification('Payment collected via Cash', 'success');
                }}
                className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-gray-100 hover:border-indigo-600 hover:bg-indigo-50 transition-all group"
              >
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
                  <CreditCard className="w-6 h-6" />
                </div>
                <span className="font-bold text-gray-700">Cash</span>
              </button>

              {upiUrl ? (
                <button 
                  onClick={() => {
                    handleMarkPaid(p.id, 'upi');
                    setPaymentModal({ isOpen: false, payment: null });
                    showNotification('Payment collected via UPI', 'success');
                  }}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-gray-100 hover:border-indigo-600 hover:bg-indigo-50 transition-all group"
                >
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
                    <TrendingUp className="w-6 h-6" />
                  </div>
                  <span className="font-bold text-gray-700">UPI</span>
                </button>
              ) : (
                <div className="flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed border-gray-200 opacity-50">
                   <span className="text-[10px] font-bold text-gray-400 text-center">Setup UPI in Settings to enable</span>
                </div>
              )}
            </div>

            {upiUrl && (
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center">
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-4">Scan to Pay (UPI)</p>
                <div className="bg-white p-4 rounded-xl inline-block border border-gray-100 shadow-sm">
                   <QRCodeSVG value={upiUrl} size={160} />
                </div>
                <p className="text-[10px] text-gray-500 mt-4 font-medium">UPI ID: {settings?.upi_id}</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    );
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-gray-100 p-8 text-center">
          <div className="bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-100">
            <TrendingUp className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-2">Welcome to GymFlow</h1>
          <p className="text-gray-500 mb-8">Manage your gym members and payments with ease.</p>
          <button
            onClick={() => signInWithPopup(auth, googleProvider)}
            className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95 flex items-center justify-center gap-3"
          >
            <Users className="w-5 h-5" />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-64 bg-white border-r border-gray-200 flex-col sticky top-0 h-screen">
        <div className="p-8">
          <div className="flex items-center gap-3 text-indigo-600 mb-8">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">GymFlow</h1>
          </div>
          
          <nav className="space-y-2">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { id: 'members', label: 'Members', icon: Users },
              { id: 'payments', label: 'Payments', icon: CreditCard },
              { id: 'settings', label: 'Settings', icon: Settings },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id as any)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  view === item.id 
                    ? 'bg-indigo-50 text-indigo-600 font-semibold' 
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </button>
            ))}
            <button
              onClick={() => auth.signOut()}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-red-500 hover:bg-red-50 mt-4"
            >
              <Trash2 className="w-5 h-5" />
              Logout
            </button>
          </nav>
        </div>
        
        <div className="mt-auto p-8 border-t border-gray-100">
          <div className="bg-indigo-600 rounded-2xl p-4 text-white">
            <p className="text-xs font-medium opacity-80 mb-1">Automation Status</p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-sm font-bold">Reminders Active</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 flex justify-around items-center z-50 shadow-lg">
        {[
          { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
          { id: 'members', label: 'Members', icon: Users },
          { id: 'payments', label: 'Payments', icon: CreditCard },
          { id: 'settings', label: 'Settings', icon: Settings },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id as any)}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
              view === item.id 
                ? 'text-indigo-600' 
                : 'text-gray-400'
            }`}
          >
            <item.icon className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-wider">{item.label}</span>
          </button>
        ))}
        <button
          onClick={() => auth.signOut()}
          className="flex flex-col items-center gap-1 p-2 rounded-xl text-red-500"
        >
          <Trash2 className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Logout</span>
        </button>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto pb-24 md:pb-8 bg-gray-50/50">
        <PaymentModal />
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 md:mb-10">
          <div className="w-full md:w-auto">
            {view === 'dashboard' ? (
              <div className="flex flex-col">
                <div className="flex items-center gap-3 mb-2">
                  <div className="h-6 md:h-8 w-1 bg-indigo-600 rounded-full" />
                  <h1 className="text-3xl md:text-5xl font-black text-indigo-900 tracking-tighter">
                    GYM<span className="text-indigo-600">FLOW</span>
                  </h1>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 font-medium text-xs md:text-base">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 md:w-4 md:h-4" />
                    <span>{format(new Date(), 'EEEE, MMM dd')}</span>
                  </div>
                  <span className="hidden md:inline mx-1">•</span>
                  <span>Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening'}, Admin</span>
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-2xl md:text-3xl font-bold text-gray-900 capitalize">{view}</h2>
                <p className="text-sm md:text-base text-gray-500">Manage your gym operations seamlessly.</p>
              </>
            )}
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
            {view === 'members' && (
              <div className="relative flex-1">
                <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input 
                  type="text" 
                  placeholder="Search members..." 
                  className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm text-base"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              {view === 'members' && (
                <button 
                  onClick={handleExportCSV}
                  className="flex-1 sm:flex-none bg-white text-gray-700 border border-gray-200 px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-50 transition-all shadow-sm touch-manipulation"
                  title="Export CSV"
                >
                  <Download className="w-5 h-5" />
                  <span className="md:inline">Export</span>
                </button>
              )}
              {view === 'members' && (
                <button 
                  onClick={() => setIsAddingMember(true)}
                  className="flex-[2] sm:flex-none bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 touch-manipulation"
                >
                  <UserPlus className="w-5 h-5" />
                  <span>Add Member</span>
                </button>
              )}
            </div>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {view === 'dashboard' && stats && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard 
                  title="Total Members" 
                  value={stats.totalMembers} 
                  icon={Users} 
                  color="bg-gradient-to-br from-blue-500 to-blue-600" 
                  onClick={() => setView('members')}
                />
                <StatCard 
                  title="Paid This Month" 
                  value={stats.paidCount} 
                  icon={CheckCircle} 
                  color="bg-gradient-to-br from-emerald-500 to-emerald-600" 
                  onClick={() => {
                    setView('payments');
                    setPaymentStatusFilter('paid');
                  }}
                />
                <StatCard 
                  title="Pending Payments" 
                  value={stats.pendingCount} 
                  icon={AlertCircle} 
                  color="bg-gradient-to-br from-orange-500 to-orange-600" 
                  onClick={() => {
                    setView('payments');
                    setPaymentStatusFilter('pending');
                  }}
                />
                <StatCard 
                  title="Monthly Revenue" 
                  value={`₹${stats.monthlyRevenue}`} 
                  icon={TrendingUp} 
                  color="bg-gradient-to-br from-indigo-500 to-indigo-600" 
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                  {/* Quick Actions */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Plus className="w-5 h-5 text-indigo-600" />
                      Quick Actions
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <button 
                        onClick={() => setIsAddingMember(true)}
                        className="flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all group"
                      >
                        <UserPlus className="w-6 h-6 text-gray-400 group-hover:text-indigo-600 mb-2" />
                        <span className="text-xs font-bold text-gray-600 group-hover:text-indigo-900">Add Member</span>
                      </button>
                      <button 
                        onClick={() => setView('payments')}
                        className="flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition-all group"
                      >
                        <CreditCard className="w-6 h-6 text-gray-400 group-hover:text-emerald-600 mb-2" />
                        <span className="text-xs font-bold text-gray-600 group-hover:text-emerald-900">Collect Fee</span>
                      </button>
                      <button 
                        onClick={handleExportCSV}
                        className="flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all group"
                      >
                        <Download className="w-6 h-6 text-gray-400 group-hover:text-blue-600 mb-2" />
                        <span className="text-xs font-bold text-gray-600 group-hover:text-blue-900">Export Data</span>
                      </button>
                      <button 
                        onClick={() => setView('settings')}
                        className="flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-gray-200 hover:border-amber-300 hover:bg-amber-50/50 transition-all group"
                      >
                        <Settings className="w-6 h-6 text-gray-400 group-hover:text-amber-600 mb-2" />
                        <span className="text-xs font-bold text-gray-600 group-hover:text-amber-900">Config</span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-bold text-gray-900">Recent Pending Payments</h3>
                      <button onClick={() => setView('payments')} className="text-indigo-600 text-sm font-bold hover:underline">View All</button>
                    </div>
                    <div className="space-y-4">
                      {stats.recentPending.length > 0 ? stats.recentPending.map((p) => (
                        <div key={p.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-50 hover:bg-gray-50 transition-all">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center text-orange-600">
                              <Bell className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="font-bold text-gray-900">{p.name}</p>
                              <p className="text-sm text-gray-500 flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> Due: {format(parseISO(p.due_date), 'dd-MM-yyyy')}
                              </p>
                            </div>
                          </div>
                          <div className="text-right flex flex-col items-end gap-1">
                            <p className="font-bold text-gray-900">₹{p.amount}</p>
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => setPaymentModal({ isOpen: true, payment: p })}
                                className="text-xs text-indigo-600 font-bold hover:underline"
                              >
                                Mark as Paid
                              </button>
                              <button 
                                onClick={() => handleWhatsAppReminder(p.member_id, p.amount, p.due_date)}
                                className="text-green-600 hover:text-green-800 transition-all"
                                title="Remind via WhatsApp"
                              >
                                <Phone className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )) : (
                        <p className="text-center text-gray-500 py-8">No pending payments! 🎉</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-indigo-900 via-indigo-800 to-indigo-900 rounded-2xl p-8 text-white relative overflow-hidden shadow-xl shadow-indigo-200">
                  <div className="relative z-10">
                    <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-md border border-white/10">
                      <TrendingUp className="w-6 h-6 text-indigo-300" />
                    </div>
                    <h3 className="text-2xl font-bold mb-4">Automation Insights</h3>
                    <p className="text-indigo-200 text-sm mb-8 leading-relaxed">
                      The system automatically checks for payments daily at 8:00 AM IST. 
                      Reminders are sent 2 days before the due date.
                    </p>
                    <div className="space-y-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center border border-white/5">
                          <Phone className="w-5 h-5 text-indigo-300" />
                        </div>
                        <div>
                          <p className="text-sm font-bold">WhatsApp Integration</p>
                          <p className="text-xs text-indigo-300">Ready to notify members</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center border border-white/5">
                          <History className="w-5 h-5 text-indigo-300" />
                        </div>
                        <div>
                          <p className="text-sm font-bold">History Logged</p>
                          <p className="text-xs text-indigo-300">Daily activity tracking</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl" />
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl" />
                </div>
              </div>
            </motion.div>
          )}

          {view === 'members' && (
            <motion.div 
              key="members"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              {/* Desktop Table */}
              <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-6 py-4 text-sm font-bold text-gray-500 uppercase">Member</th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-500 uppercase">Plan</th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-500 uppercase">Join Date</th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-500 uppercase">Fee</th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-500 uppercase">Status</th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-500 uppercase">Status History</th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {members
                      .filter(m => 
                        m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        m.phone.includes(searchQuery)
                      )
                      .map((m) => (
                      <tr key={m.id} className="hover:bg-gray-50 transition-all">
                        <td className="px-6 py-4">
                          <p className="font-bold text-gray-900">{m.name}</p>
                          <p className="text-sm text-gray-500">{m.phone}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold capitalize">
                            {m.plan}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {format(parseISO(m.join_date), 'dd-MM-yyyy')}
                        </td>
                        <td className="px-6 py-4 font-bold text-gray-900">₹{m.fee_amount}</td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${
                            m.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                          }`}>
                            {m.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            {m.status_history?.slice(-3).reverse().map((h, i) => (
                              <div key={`${h.date}-${h.status}-${i}`} className="flex items-center gap-2 text-[10px]">
                                <span className={`w-1.5 h-1.5 rounded-full ${h.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
                                <span className="text-gray-600 font-medium capitalize">{h.status}</span>
                                <span className="text-gray-400">({format(parseISO(h.date), 'dd-MM')})</span>
                              </div>
                            ))}
                            {m.status_history && m.status_history.length > 3 && (
                              <span className="text-[10px] text-gray-400 italic">+{m.status_history.length - 3} more</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={() => {
                                setEditingMember(m);
                                setIsEditingMember(true);
                              }}
                              className="text-amber-600 hover:text-amber-800 transition-all flex items-center gap-1 text-xs font-bold"
                            >
                              <Edit2 className="w-4 h-4" />
                              Edit
                            </button>
                            <button 
                              onClick={() => fetchMemberHistory(m)}
                              className="text-indigo-600 hover:text-indigo-800 transition-all flex items-center gap-1 text-xs font-bold"
                            >
                              <History className="w-4 h-4" />
                              History
                            </button>
                            <button 
                              onClick={() => handleDeleteMember(m.id)}
                              className="text-red-500 hover:text-red-700 transition-all"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-4">
                {members
                  .filter(m => 
                    m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                    m.phone.includes(searchQuery)
                  )
                  .map((m) => (
                  <div key={m.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-black text-gray-900 text-lg">{m.name}</p>
                        <p className="text-sm text-gray-500 font-medium">{m.phone}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        m.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                      }`}>
                        {m.status}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 py-3 border-y border-gray-50">
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Plan</p>
                        <p className="text-sm font-bold text-indigo-600 capitalize">{m.plan}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Fee</p>
                        <p className="text-sm font-black text-gray-900">₹{m.fee_amount}</p>
                      </div>
                    </div>

                    <div className="py-2 border-b border-gray-50">
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-2">Status History</p>
                      <div className="flex flex-wrap gap-2">
                        {m.status_history?.slice(-3).reverse().map((h, i) => (
                          <div key={`${h.date}-${h.status}-${i}`} className="flex items-center gap-1.5 bg-gray-50 px-2 py-1 rounded-lg text-[10px]">
                            <span className={`w-1 h-1 rounded-full ${h.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span className="text-gray-600 font-bold capitalize">{h.status}</span>
                            <span className="text-gray-400">{format(parseISO(h.date), 'dd-MM')}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <p className="text-xs text-gray-500">Joined: {format(parseISO(m.join_date), 'dd-MM-yyyy')}</p>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => {
                            setEditingMember(m);
                            setIsEditingMember(true);
                          }}
                          className="p-2 text-amber-600 bg-amber-50 rounded-lg touch-manipulation"
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => fetchMemberHistory(m)}
                          className="p-2 text-indigo-600 bg-indigo-50 rounded-lg touch-manipulation"
                        >
                          <History className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleDeleteMember(m.id)}
                          className="p-2 text-red-500 bg-red-50 rounded-lg touch-manipulation"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination Controls */}
              <div className="flex items-center justify-between mt-6 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <p className="text-sm text-gray-500 font-medium">
                  Showing page <span className="font-bold text-gray-900">{membersPage}</span>
                </p>
                <div className="flex gap-2">
                  <button 
                    onClick={handlePrevMembers}
                    disabled={membersPage === 1}
                    className="px-4 py-2 rounded-xl text-sm font-bold border border-gray-200 disabled:opacity-50 hover:bg-gray-50 transition-all"
                  >
                    Previous
                  </button>
                  <button 
                    onClick={handleNextMembers}
                    disabled={members.length < membersPageSize}
                    className="px-4 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white disabled:opacity-50 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                  >
                    Next
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'payments' && (
            <motion.div 
              key="payments"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-100 w-full sm:w-fit shadow-sm overflow-x-auto no-scrollbar">
                  {(['all', 'paid', 'pending'] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() => setPaymentStatusFilter(status)}
                      className={`flex-1 sm:flex-none px-6 py-2.5 rounded-lg text-sm font-bold capitalize transition-all whitespace-nowrap ${
                        paymentStatusFilter === status 
                          ? 'bg-indigo-600 text-white shadow-md' 
                          : 'text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-6 py-4 w-10">
                        <input 
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          checked={selectedPayments.length > 0 && selectedPayments.length === pendingPaymentsForBulk.length}
                          onChange={() => toggleAllPayments(pendingPaymentsForBulk.map(p => p.id))}
                        />
                      </th>
                      <th 
                        className="px-6 py-4 text-sm font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('name')}
                      >
                        <div className="flex items-center gap-1">
                          Member
                          {sortField === 'name' && (
                            sortOrder === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-4 text-sm font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('amount')}
                      >
                        <div className="flex items-center gap-1">
                          Amount
                          {sortField === 'amount' && (
                            sortOrder === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-4 text-sm font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('due_date')}
                      >
                        <div className="flex items-center gap-1">
                          Due Date
                          {sortField === 'due_date' && (
                            sortOrder === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="px-6 py-4 text-sm font-bold text-gray-500 uppercase cursor-pointer hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('status')}
                      >
                        <div className="flex items-center gap-1">
                          Status
                          {sortField === 'status' && (
                            sortOrder === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                          )}
                        </div>
                      </th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-500 uppercase">Payment Date</th>
                      <th className="px-6 py-4 text-sm font-bold text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredPayments.map((p) => (
                      <tr key={p.id} className={`hover:bg-gray-50 transition-all ${selectedPayments.includes(p.id) ? 'bg-indigo-50/30' : ''}`}>
                        <td className="px-6 py-4">
                          {p.status === 'pending' && (
                            <input 
                              type="checkbox"
                              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              checked={selectedPayments.includes(p.id)}
                              onChange={() => togglePaymentSelection(p.id)}
                            />
                          )}
                        </td>
                        <td className="px-6 py-4 font-bold text-gray-900">{p.name}</td>
                        <td className="px-6 py-4 font-bold text-gray-900">₹{p.amount}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {format(parseISO(p.due_date), 'dd-MM-yyyy')}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${
                            p.status === 'paid' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                          }`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {p.payment_date ? format(parseISO(p.payment_date), 'dd-MM-yyyy') : '-'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {p.status === 'pending' && (
                              <>
                                <button 
                                  onClick={() => setPaymentModal({ isOpen: true, payment: p })}
                                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all"
                                >
                                  Mark Paid
                                </button>
                                <button 
                                  onClick={() => handleWhatsAppReminder(p.member_id, p.amount, p.due_date)}
                                  className="p-2 text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-all"
                                  title="Remind via WhatsApp"
                                >
                                  <Phone className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-4 pb-20">
                {filteredPayments.map((p) => (
                  <div key={p.id} className={`bg-white p-5 rounded-2xl shadow-sm border transition-all ${selectedPayments.includes(p.id) ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-100'} space-y-4`}>
                    <div className="flex justify-between items-start">
                      <div className="flex gap-3">
                        {p.status === 'pending' && (
                          <input 
                            type="checkbox"
                            className="w-5 h-5 mt-1 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            checked={selectedPayments.includes(p.id)}
                            onChange={() => togglePaymentSelection(p.id)}
                          />
                        )}
                        <div>
                          <p className="font-black text-gray-900 text-lg">{p.name}</p>
                          <p className="text-sm font-black text-indigo-600">₹{p.amount}</p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        p.status === 'paid' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                      }`}>
                        {p.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 py-3 border-y border-gray-50">
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Due Date</p>
                        <p className="text-sm font-bold text-gray-700">{format(parseISO(p.due_date), 'dd-MM-yyyy')}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Paid On</p>
                        <p className="text-sm font-bold text-gray-700">{p.payment_date ? format(parseISO(p.payment_date), 'dd-MM-yyyy') : '-'}</p>
                      </div>
                    </div>

                    {p.status === 'pending' && (
                      <div className="flex gap-3">
                        <button 
                          onClick={() => setPaymentModal({ isOpen: true, payment: p })}
                          className="flex-1 bg-indigo-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 touch-manipulation"
                        >
                          Mark as Paid
                        </button>
                        <button 
                          onClick={() => handleWhatsAppReminder(p.member_id, p.amount, p.due_date)}
                          className="px-4 py-3 bg-green-50 text-green-600 rounded-xl font-bold hover:bg-green-100 transition-all touch-manipulation"
                        >
                          <Phone className="w-5 h-5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Pagination Controls */}
              <div className="flex items-center justify-between mt-6 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <p className="text-sm text-gray-500 font-medium">
                  Showing page <span className="font-bold text-gray-900">{paymentsPage}</span>
                </p>
                <div className="flex gap-2">
                  <button 
                    onClick={handlePrevPayments}
                    disabled={paymentsPage === 1}
                    className="px-4 py-2 rounded-xl text-sm font-bold border border-gray-200 disabled:opacity-50 hover:bg-gray-50 transition-all"
                  >
                    Previous
                  </button>
                  <button 
                    onClick={handleNextPayments}
                    disabled={payments.length < paymentsPageSize}
                    className="px-4 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white disabled:opacity-50 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                  >
                    Next
                  </button>
                </div>
              </div>

              {/* Bulk Action Bar */}
              <AnimatePresence>
                {selectedPayments.length > 0 && (
                  <motion.div 
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 100, opacity: 0 }}
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-lg bg-gray-900 text-white p-4 rounded-2xl shadow-2xl z-40 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-indigo-600 px-3 py-1 rounded-lg font-black text-sm">
                        {selectedPayments.length}
                      </div>
                      <p className="text-sm font-bold">Payments Selected</p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setSelectedPayments([])}
                        className="px-4 py-2 text-sm font-bold text-gray-400 hover:text-white transition-all"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={handleBulkMarkPaid}
                        className="bg-indigo-600 px-6 py-2 rounded-xl text-sm font-black hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-900/20"
                      >
                        Mark Paid
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {view === 'settings' && settings && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="max-w-2xl bg-white rounded-3xl shadow-sm border border-gray-100 p-5 md:p-8"
            >
              <div className="flex flex-wrap gap-4 mb-8">
                <button 
                  onClick={handleRunAutomation}
                  disabled={isRunningAutomation}
                  className="flex-1 bg-indigo-600 text-white px-6 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50 touch-manipulation"
                >
                  <Bell className="w-5 h-5" />
                  {isRunningAutomation ? 'Running...' : 'Run Automation Now'}
                </button>
                <button 
                  onClick={handleSeedData}
                  disabled={isSeedingData}
                  className="flex-1 bg-white text-indigo-600 border-2 border-indigo-100 px-6 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:border-indigo-200 hover:bg-indigo-50 transition-all disabled:opacity-50 touch-manipulation"
                >
                  <Plus className="w-5 h-5" />
                  {isSeedingData ? 'Seeding...' : 'Seed Test Data'}
                </button>
              </div>

              <div className="flex items-center gap-4 mb-6 md:mb-8">
                <div className="p-3 bg-indigo-100 rounded-xl text-indigo-600">
                  <Settings className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg md:text-xl font-bold text-gray-900">Automation Settings</h3>
                  <p className="text-xs md:text-sm text-gray-500">Configure how and when reminders are sent.</p>
                </div>
              </div>

              <form onSubmit={handleUpdateSettings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                  <div>
                    <label className="block text-xs md:text-sm font-bold text-gray-700 mb-2">
                      Upcoming Reminder Days
                    </label>
                    <div className="relative">
                      <input 
                        type="number" 
                        min="1"
                        max="30"
                        className="w-full pl-4 pr-12 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                        value={settings.reminder_days_before}
                        onChange={e => setSettings({...settings, reminder_days_before: e.target.value})}
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">Days</span>
                    </div>
                    <p className="mt-2 text-[10px] md:text-xs text-gray-500">How many days before the due date to send the first reminder.</p>
                  </div>

                  <div>
                    <label className="block text-xs md:text-sm font-bold text-gray-700 mb-2">
                      Overdue Frequency
                    </label>
                    <div className="relative">
                      <input 
                        type="number" 
                        min="1"
                        max="30"
                        className="w-full pl-4 pr-12 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                        value={settings.overdue_reminder_frequency}
                        onChange={e => setSettings({...settings, overdue_reminder_frequency: e.target.value})}
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">Days</span>
                    </div>
                    <p className="mt-2 text-[10px] md:text-xs text-gray-500">How often to repeat reminders for overdue payments.</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-xs md:text-sm font-bold text-gray-700 mb-2">
                      Upcoming Payment Message
                    </label>
                    <textarea 
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-base"
                      value={settings.upcoming_message}
                      onChange={e => setSettings({...settings, upcoming_message: e.target.value})}
                      placeholder="Enter message for upcoming payments..."
                    />
                    <p className="mt-2 text-[10px] md:text-xs text-gray-500">Use <code className="bg-gray-100 px-1 rounded text-indigo-600">{`{days}`}</code> to insert the number of days remaining.</p>
                    
                    <div className="mt-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100 flex justify-between items-start">
                      <div>
                        <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-2">Preview (Upcoming)</p>
                        <p className="text-xs md:text-sm text-gray-700 italic">
                          "{settings.upcoming_message.replace('{days}', settings.reminder_days_before || '2')}"
                        </p>
                      </div>
                      <button 
                        type="button"
                        onClick={() => {
                          const msg = settings.upcoming_message.replace('{days}', settings.reminder_days_before || '2');
                          window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
                        }}
                        className="p-2 bg-white text-green-600 rounded-lg shadow-sm hover:shadow-md transition-all"
                        title="Test WhatsApp Message"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs md:text-sm font-bold text-gray-700 mb-2">
                      Overdue Payment Message
                    </label>
                    <textarea 
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-base"
                      value={settings.overdue_message}
                      onChange={e => setSettings({...settings, overdue_message: e.target.value})}
                      placeholder="Enter message for overdue payments..."
                    />
                    <p className="mt-2 text-[10px] md:text-xs text-gray-500">This message is sent repeatedly based on the overdue frequency.</p>

                    <div className="mt-4 p-4 bg-red-50 rounded-xl border border-red-100 flex justify-between items-start">
                      <div>
                        <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-2">Preview (Overdue)</p>
                        <p className="text-xs md:text-sm text-gray-700 italic">
                          "{settings.overdue_message}"
                        </p>
                      </div>
                      <button 
                        type="button"
                        onClick={() => {
                          window.open(`https://wa.me/?text=${encodeURIComponent(settings.overdue_message)}`, '_blank');
                        }}
                        className="p-2 bg-white text-green-600 rounded-lg shadow-sm hover:shadow-md transition-all"
                        title="Test WhatsApp Message"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-gray-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-blue-600" />
                      </div>
                      <h4 className="text-sm font-bold text-gray-900">Payment Gateway Settings</h4>
                    </div>
                    <label className="block text-xs md:text-sm font-bold text-gray-700 mb-2">
                      Your UPI ID (for QR Code)
                    </label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                      value={settings.upi_id || ''}
                      onChange={e => setSettings({...settings, upi_id: e.target.value})}
                      placeholder="e.g. yourname@upi"
                    />
                    <p className="mt-2 text-[10px] md:text-xs text-gray-500">
                      Providing a UPI ID enables the QR code payment option when collecting fees.
                    </p>
                  </div>

                  <div className="pt-6 border-t border-gray-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center">
                        <Phone className="w-4 h-4 text-green-600" />
                      </div>
                      <h4 className="text-sm font-bold text-gray-900">n8n WhatsApp Integration</h4>
                    </div>
                    <label className="block text-xs md:text-sm font-bold text-gray-700 mb-2">
                      n8n Webhook URL
                    </label>
                    <input 
                      type="url" 
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                      value={settings.whatsapp_webhook_url || ''}
                      onChange={e => setSettings({...settings, whatsapp_webhook_url: e.target.value})}
                      placeholder="https://your-n8n-instance.com/webhook/..."
                    />
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={handleTestWebhook}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 bg-indigo-50 px-3 py-2 rounded-lg transition-all"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Send Test Webhook to n8n
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] md:text-xs text-gray-500">
                      If provided, automation will send a POST request to this URL with member details and message.
                    </p>
                  </div>
                </div>

                <div className="pt-4 flex flex-col sm:flex-row justify-end gap-3">
                  <button 
                    type="button"
                    onClick={handleCleanDuplicates}
                    className="w-full md:w-auto bg-amber-50 text-amber-700 px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-amber-100 transition-all touch-manipulation"
                  >
                    <RefreshCw className="w-5 h-5" />
                    Clean Duplicates
                  </button>
                  <button 
                    type="button"
                    onClick={handleSeedData}
                    className="w-full md:w-auto bg-indigo-50 text-indigo-700 px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-100 transition-all touch-manipulation"
                  >
                    <Plus className="w-5 h-5" />
                    Seed Test Data
                  </button>
                  <button 
                    type="submit"
                    disabled={isSavingSettings}
                    className="w-full md:w-auto bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50 touch-manipulation"
                  >
                    <Save className="w-5 h-5" />
                    {isSavingSettings ? 'Saving...' : 'Save Configuration'}
                  </button>
                </div>
              </form>

              {/* Automation Logs Section */}
              <div className="mt-12 pt-12 border-t border-gray-100">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                    <History className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Automation Logs</h3>
                    <p className="text-sm text-gray-500">Recent automated WhatsApp reminders (simulated)</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">Time</th>
                          <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">Member</th>
                          <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">Type</th>
                          <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {automationLogs.length > 0 ? automationLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-gray-50 transition-all">
                            <td className="px-6 py-4 text-xs text-gray-500 whitespace-nowrap">
                              {log.timestamp ? format(log.timestamp.toDate(), 'dd-MM HH:mm') : 'Just now'}
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm font-bold text-gray-900">{log.member_name}</p>
                              <p className="text-[10px] text-gray-500">{log.phone}</p>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 rounded-full text-[10px] font-bold capitalize ${
                                log.type === 'upcoming_reminder' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'
                              }`}>
                                {log.type.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-xs text-gray-600 line-clamp-1 max-w-xs" title={log.message}>
                                {log.message}
                              </p>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={4} className="px-6 py-12 text-center text-gray-500 text-sm italic">
                              No automation logs yet. The system checks daily at 8:00 AM IST.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Add Member Modal */}
      {isAddingMember && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <motion.div 
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-white rounded-t-[2.5rem] sm:rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl overflow-y-auto max-h-[90vh]"
          >
            <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Add New Member</h3>
            <form onSubmit={handleAddMember} className="space-y-4">
              <div>
                <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">Full Name</label>
                <input 
                  required
                  type="text" 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                  value={newMember.name}
                  onChange={e => setNewMember({...newMember, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">Phone Number</label>
                <input 
                  required
                  type="tel" 
                  placeholder="91XXXXXXXXXX"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                  value={newMember.phone}
                  onChange={e => setNewMember({...newMember, phone: e.target.value})}
                />
                <p className="text-[10px] text-gray-400 mt-1">Format: 91 followed by 10 digits</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">Join Date</label>
                  <input 
                    required
                    type="date" 
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                    value={newMember.join_date}
                    onChange={e => setNewMember({...newMember, join_date: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">Plan</label>
                  <select 
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                    value={newMember.plan}
                    onChange={e => setNewMember({...newMember, plan: e.target.value})}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">Fee Amount (₹)</label>
                <input 
                  required
                  type="number" 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                  value={newMember.fee_amount}
                  onChange={e => setNewMember({...newMember, fee_amount: e.target.value === '' ? 0 : parseInt(e.target.value)})}
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsAddingMember(false)}
                  className="w-full sm:flex-1 px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-all touch-manipulation"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="w-full sm:flex-1 px-6 py-3 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 touch-manipulation"
                >
                  Save Member
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Edit Member Modal */}
      {isEditingMember && editingMember && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <motion.div 
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-white rounded-t-[2.5rem] sm:rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl overflow-y-auto max-h-[90vh]"
          >
            <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Edit Member</h3>
            <form onSubmit={handleEditMember} className="space-y-4">
              <div>
                <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">Full Name</label>
                <input 
                  required
                  type="text" 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                  value={editingMember.name}
                  onChange={e => setEditingMember({...editingMember, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">Phone Number</label>
                <input 
                  required
                  type="tel" 
                  placeholder="91XXXXXXXXXX"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                  value={editingMember.phone}
                  onChange={e => setEditingMember({...editingMember, phone: e.target.value})}
                />
                <p className="text-[10px] text-gray-400 mt-1">Format: 91 followed by 10 digits</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">Status</label>
                  <select 
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                    value={editingMember.status}
                    onChange={e => setEditingMember({...editingMember, status: e.target.value})}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">Plan</label>
                  <select 
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                    value={editingMember.plan}
                    onChange={e => setEditingMember({...editingMember, plan: e.target.value})}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs md:text-sm font-bold text-gray-700 mb-1">Fee Amount (₹)</label>
                <input 
                  required
                  type="number" 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                  value={editingMember.fee_amount}
                  onChange={e => setEditingMember({...editingMember, fee_amount: e.target.value === '' ? 0 : parseInt(e.target.value)})}
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => {
                    setIsEditingMember(false);
                    setEditingMember(null);
                  }}
                  className="w-full sm:flex-1 px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-all touch-manipulation"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="w-full sm:flex-1 px-6 py-3 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 touch-manipulation"
                >
                  Update Member
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      {/* Payment History Modal */}
      {isHistoryModalOpen && selectedMemberForHistory && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <motion.div 
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="bg-white rounded-t-[2.5rem] sm:rounded-3xl p-6 md:p-8 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl md:text-2xl font-bold text-gray-900">Payment History</h3>
                <p className="text-xs md:text-sm text-gray-500">Records for {selectedMemberForHistory.name}</p>
              </div>
              <button 
                onClick={() => setIsHistoryModalOpen(false)}
                className="p-2 -mr-2 text-gray-400 hover:text-gray-600 transition-all touch-manipulation"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 -mr-2">
              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Due Date</th>
                      <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Paid Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {memberHistory.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50 transition-all">
                        <td className="px-4 py-4 text-sm text-gray-600 font-medium">
                          {format(parseISO(p.due_date), 'dd-MM-yyyy')}
                        </td>
                        <td className="px-4 py-4 text-sm font-bold text-gray-900">₹{p.amount}</td>
                        <td className="px-4 py-4">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold capitalize ${
                            p.status === 'paid' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                          }`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-600">
                          {p.payment_date ? format(parseISO(p.payment_date), 'dd-MM-yyyy') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile View */}
              <div className="md:hidden space-y-3">
                {memberHistory.map((p) => (
                  <div key={p.id} className="p-4 rounded-2xl bg-gray-50 border border-gray-100 flex justify-between items-center">
                    <div>
                      <p className="text-sm font-bold text-gray-900">{format(parseISO(p.due_date), 'dd-MM-yyyy')}</p>
                      <p className="text-xs text-gray-500">
                        {p.payment_date ? `Paid: ${format(parseISO(p.payment_date), 'dd-MM-yyyy')}` : 'Pending'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-indigo-600">₹{p.amount}</p>
                      <span className={`text-[10px] font-black uppercase ${
                        p.status === 'paid' ? 'text-green-600' : 'text-orange-600'
                      }`}>
                        {p.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {/* Notifications */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-6 right-6 z-[100] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border ${
              notification.type === 'success' ? 'bg-green-50 border-green-100 text-green-800' :
              notification.type === 'error' ? 'bg-red-50 border-red-100 text-red-800' :
              'bg-blue-50 border-blue-100 text-blue-800'
            }`}
          >
            {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> :
             notification.type === 'error' ? <AlertCircle className="w-5 h-5" /> :
             <Bell className="w-5 h-5" />}
            <span className="font-bold text-sm">{notification.message}</span>
            <button onClick={() => setNotification(null)} className="ml-2 hover:opacity-70">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-6">
                <AlertTriangle className="w-8 h-8 text-amber-600" />
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-2">{confirmModal.title}</h3>
              <p className="text-gray-600 mb-8 leading-relaxed font-medium">{confirmModal.message}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmModal(null)}
                  className="flex-1 px-6 py-4 rounded-2xl font-bold text-gray-500 hover:bg-gray-100 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmModal.onConfirm}
                  className="flex-1 px-6 py-4 rounded-2xl font-bold bg-red-600 text-white hover:bg-red-700 transition-all shadow-lg shadow-red-100"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
