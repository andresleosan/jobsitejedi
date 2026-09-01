import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ManagerDashboard from "@/components/dashboard/ManagerDashboard";
import { roleHomePath } from "@/lib/firebase/types";

const Admins = () => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (user.role && user.role !== "admin") {
      navigate(roleHomePath(user.role), { replace: true });
    }
  }, [isLoading, navigate, user]);

  if (isLoading || !user || user.role !== "admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary motion-reduce:animate-none" />
      </div>
    );
  }

  return <ManagerDashboard userId={user.id} email={user.email} role="admin" />;
};

export default Admins;
