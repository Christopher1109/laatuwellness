export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          amount_cents: number | null
          category: string
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          subject_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          amount_cents?: number | null
          category: string
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          subject_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          amount_cents?: number | null
          category?: string
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          subject_user_id?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          class_id: string
          created_at: string
          id: string
          seat_number: number | null
          status: string
          tokens_spent: number
          user_id: string
          waitlisted_at: string | null
        }
        Insert: {
          class_id: string
          created_at?: string
          id?: string
          seat_number?: number | null
          status?: string
          tokens_spent?: number
          user_id: string
          waitlisted_at?: string | null
        }
        Update: {
          class_id?: string
          created_at?: string
          id?: string
          seat_number?: number | null
          status?: string
          tokens_spent?: number
          user_id?: string
          waitlisted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          booking_id: string
          checked_in_by: string | null
          created_at: string
          id: string
          status: string
        }
        Insert: {
          booking_id: string
          checked_in_by?: string | null
          created_at?: string
          id?: string
          status?: string
        }
        Update: {
          booking_id?: string
          checked_in_by?: string | null
          created_at?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      class_types: {
        Row: {
          active: boolean
          created_at: string
          description: string
          id: string
          module_key: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          module_key: string
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          module_key?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      classes: {
        Row: {
          active: boolean
          capacity: number
          class_type_id: string | null
          coach_id: string | null
          created_at: string
          duration_min: number
          id: string
          instructor: string
          module_key: string | null
          room: string
          starts_at: string
          tokens_cost: number
        }
        Insert: {
          active?: boolean
          capacity?: number
          class_type_id?: string | null
          coach_id?: string | null
          created_at?: string
          duration_min?: number
          id?: string
          instructor?: string
          module_key?: string | null
          room?: string
          starts_at: string
          tokens_cost?: number
        }
        Update: {
          active?: boolean
          capacity?: number
          class_type_id?: string | null
          coach_id?: string | null
          created_at?: string
          duration_min?: number
          id?: string
          instructor?: string
          module_key?: string | null
          room?: string
          starts_at?: string
          tokens_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "classes_class_type_id_fkey"
            columns: ["class_type_id"]
            isOneToOne: false
            referencedRelation: "class_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coaches: {
        Row: {
          active: boolean
          bio: string
          id: string
          image_url: string | null
          name: string
          sort_order: number
          specialty: string
        }
        Insert: {
          active?: boolean
          bio?: string
          id?: string
          image_url?: string | null
          name: string
          sort_order?: number
          specialty?: string
        }
        Update: {
          active?: boolean
          bio?: string
          id?: string
          image_url?: string | null
          name?: string
          sort_order?: number
          specialty?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          coupon_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          coupon_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          kind: string
          max_uses: number | null
          reward_tokens: number
          times_used: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          kind?: string
          max_uses?: number | null
          reward_tokens?: number
          times_used?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          kind?: string
          max_uses?: number | null
          reward_tokens?: number
          times_used?: number
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          product_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          product_id: string
          reason?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          product_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message?: string
          name: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      membership_fees: {
        Row: {
          amount_cents: number
          booking_id: string | null
          charged_at: string | null
          created_at: string
          created_by: string | null
          id: string
          reason: string
          status: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          booking_id?: string | null
          charged_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string
          status?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          booking_id?: string | null
          charged_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_fees_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_adjustments: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          id: string
          reason: string
          staff_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string
          staff_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_adjustments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_period_hours: {
        Row: {
          created_at: string
          hours: number
          id: string
          period_end: string
          period_start: string
          source: string
          staff_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          hours?: number
          id?: string
          period_end: string
          period_start: string
          source?: string
          staff_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          hours?: number
          id?: string
          period_end?: string
          period_start?: string
          source?: string
          staff_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_period_hours_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sale_items: {
        Row: {
          description: string
          id: string
          product_id: string | null
          qty: number
          sale_id: string
          unit_price_cents: number
        }
        Insert: {
          description?: string
          id?: string
          product_id?: string | null
          qty?: number
          sale_id: string
          unit_price_cents?: number
        }
        Update: {
          description?: string
          id?: string
          product_id?: string | null
          qty?: number
          sale_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sales: {
        Row: {
          created_at: string
          id: string
          payment_method: string
          sold_by: string | null
          status: string
          total_cents: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          payment_method?: string
          sold_by?: string | null
          status?: string
          total_cents?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          payment_method?: string
          sold_by?: string | null
          status?: string
          total_cents?: number
          user_id?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          category: string
          cost_cents: number
          created_at: string
          expires_at: string | null
          id: string
          image_url: string | null
          low_stock_threshold: number
          name: string
          price_cents: number
          sku: string | null
          stock: number
          unit: string
          unit_size: string
        }
        Insert: {
          active?: boolean
          category?: string
          cost_cents?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          low_stock_threshold?: number
          name: string
          price_cents?: number
          sku?: string | null
          stock?: number
          unit?: string
          unit_size?: string
        }
        Update: {
          active?: boolean
          category?: string
          cost_cents?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          low_stock_threshold?: number
          name?: string
          price_cents?: number
          sku?: string | null
          stock?: number
          unit?: string
          unit_size?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          admin_notes: string
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
        }
        Insert: {
          admin_notes?: string
          created_at?: string
          email?: string
          full_name?: string
          id: string
          phone?: string | null
        }
        Update: {
          admin_notes?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      shift_claims: {
        Row: {
          created_at: string
          for_date: string
          id: string
          shift_slot_id: string
          staff_id: string
          status: string
        }
        Insert: {
          created_at?: string
          for_date?: string
          id?: string
          shift_slot_id: string
          staff_id: string
          status?: string
        }
        Update: {
          created_at?: string
          for_date?: string
          id?: string
          shift_slot_id?: string
          staff_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_claims_shift_slot_id_fkey"
            columns: ["shift_slot_id"]
            isOneToOne: false
            referencedRelation: "shift_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_claims_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_slots: {
        Row: {
          active: boolean
          created_at: string
          end_time: string
          id: string
          notes: string
          role_needed: Database["public"]["Enums"]["app_role"]
          spots_needed: number
          start_time: string
          weekday: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          end_time: string
          id?: string
          notes?: string
          role_needed?: Database["public"]["Enums"]["app_role"]
          spots_needed?: number
          start_time: string
          weekday: number
        }
        Update: {
          active?: boolean
          created_at?: string
          end_time?: string
          id?: string
          notes?: string
          role_needed?: Database["public"]["Enums"]["app_role"]
          spots_needed?: number
          start_time?: string
          weekday?: number
        }
        Relationships: []
      }
      site_modules: {
        Row: {
          bookable: boolean
          category: string
          description: string
          enabled: boolean
          key: string
          long_description: string
          name: string
          sort_order: number
        }
        Insert: {
          bookable?: boolean
          category?: string
          description?: string
          enabled?: boolean
          key: string
          long_description?: string
          name: string
          sort_order?: number
        }
        Update: {
          bookable?: boolean
          category?: string
          description?: string
          enabled?: boolean
          key?: string
          long_description?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      staff_profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string
          full_name: string
          hourly_rate_cents: number
          id: string
          phone: string | null
          photo_url: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string
          full_name: string
          hourly_rate_cents?: number
          id?: string
          phone?: string | null
          photo_url?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          full_name?: string
          hourly_rate_cents?: number
          id?: string
          phone?: string | null
          photo_url?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string | null
        }
        Relationships: []
      }
      time_clock_entries: {
        Row: {
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          note: string
          photo_url: string | null
          staff_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          note?: string
          photo_url?: string | null
          staff_id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          note?: string
          photo_url?: string | null
          staff_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_clock_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      token_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          reason: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          reason?: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          reason?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_ledger_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      token_plans: {
        Row: {
          active: boolean
          category: string
          created_at: string
          currency: string
          description: string
          excludes: string
          id: string
          includes: string
          is_staff_only: boolean
          name: string
          price_cents: number
          recurring: boolean
          sort_order: number
          stripe_price_id: string
          subtitle: string
          terms: string
          tokens: number
          validity_days: number | null
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          currency?: string
          description?: string
          excludes?: string
          id?: string
          includes?: string
          is_staff_only?: boolean
          name: string
          price_cents: number
          recurring?: boolean
          sort_order?: number
          stripe_price_id?: string
          subtitle?: string
          terms?: string
          tokens: number
          validity_days?: number | null
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          currency?: string
          description?: string
          excludes?: string
          id?: string
          includes?: string
          is_staff_only?: boolean
          name?: string
          price_cents?: number
          recurring?: boolean
          sort_order?: number
          stripe_price_id?: string
          subtitle?: string
          terms?: string
          tokens?: number
          validity_days?: number | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          external_ref: string | null
          id: string
          payment_method: string
          plan_id: string | null
          status: string
          tokens: number
          user_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          currency?: string
          external_ref?: string | null
          id?: string
          payment_method?: string
          plan_id?: string | null
          status?: string
          tokens?: number
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          external_ref?: string | null
          id?: string
          payment_method?: string
          plan_id?: string | null
          status?: string
          tokens?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "token_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waiver_signatures: {
        Row: {
          full_name: string
          signature_data: string
          signed_at: string
          user_id: string
        }
        Insert: {
          full_name?: string
          signature_data: string
          signed_at?: string
          user_id: string
        }
        Update: {
          full_name?: string
          signature_data?: string
          signed_at?: string
          user_id?: string
        }
        Relationships: []
      }
      weekend_coach_rotation: {
        Row: {
          coach_id: string
          created_at: string
          day_of_week: number
          id: string
          position: number
        }
        Insert: {
          coach_id: string
          created_at?: string
          day_of_week: number
          id?: string
          position: number
        }
        Update: {
          coach_id?: string
          created_at?: string
          day_of_week?: number
          id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekend_coach_rotation_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_stock: {
        Args: { _delta: number; _product_id: string; _reason: string }
        Returns: {
          active: boolean
          category: string
          cost_cents: number
          created_at: string
          expires_at: string | null
          id: string
          image_url: string | null
          low_stock_threshold: number
          name: string
          price_cents: number
          sku: string | null
          stock: number
          unit: string
          unit_size: string
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_adjust_tokens: {
        Args: { _delta: number; _reason: string; _user_id: string }
        Returns: number
      }
      admin_book_class: {
        Args: { _class_id: string; _seat?: number; _user_id: string }
        Returns: {
          class_id: string
          created_at: string
          id: string
          seat_number: number | null
          status: string
          tokens_spent: number
          user_id: string
          waitlisted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_purchase_plan: {
        Args: { _payment_method: string; _plan_id: string; _user_id: string }
        Returns: string
      }
      book_class:
        | {
            Args: { _class_id: string }
            Returns: {
              class_id: string
              created_at: string
              id: string
              seat_number: number | null
              status: string
              tokens_spent: number
              user_id: string
              waitlisted_at: string | null
            }
            SetofOptions: {
              from: "*"
              to: "bookings"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { _class_id: string; _seat?: number }
            Returns: {
              class_id: string
              created_at: string
              id: string
              seat_number: number | null
              status: string
              tokens_spent: number
              user_id: string
              waitlisted_at: string | null
            }
            SetofOptions: {
              from: "*"
              to: "bookings"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      cancel_booking: {
        Args: { _booking_id: string }
        Returns: {
          class_id: string
          created_at: string
          id: string
          seat_number: number | null
          status: string
          tokens_spent: number
          user_id: string
          waitlisted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      class_seats_taken: { Args: { _class_id: string }; Returns: number }
      class_taken_seats: { Args: { _class_id: string }; Returns: number[] }
      class_waitlist_count: { Args: { _class_id: string }; Returns: number }
      client_place_order:
        | { Args: { _items: Json }; Returns: string }
        | { Args: { _items: Json; _note?: string }; Returns: string }
      fulfill_plan_purchase: {
        Args: {
          _external_ref: string
          _payment_method?: string
          _plan_id: string
          _user_id: string
        }
        Returns: string
      }
      get_weekend_coach: {
        Args: { _date: string }
        Returns: {
          coach_id: string
          coach_name: string
        }[]
      }
      has_active_membership: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      join_waitlist: {
        Args: { _class_id: string }
        Returns: {
          class_id: string
          created_at: string
          id: string
          seat_number: number | null
          status: string
          tokens_spent: number
          user_id: string
          waitlisted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_waitlist: {
        Args: { _booking_id: string }
        Returns: {
          class_id: string
          created_at: string
          id: string
          seat_number: number | null
          status: string
          tokens_spent: number
          user_id: string
          waitlisted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      link_existing_staff_accounts: { Args: never; Returns: undefined }
      log_activity: {
        Args: {
          _action: string
          _amount_cents?: number
          _category: string
          _description: string
          _entity_id?: string
          _entity_type?: string
          _metadata?: Json
          _subject?: string
        }
        Returns: undefined
      }
      mark_no_show: {
        Args: { _booking_id: string; _penalty_cents?: number }
        Returns: {
          booking_id: string
          checked_in_by: string | null
          created_at: string
          id: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "check_ins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      person_label: { Args: { _user_id: string }; Returns: string }
      pos_checkout: {
        Args: { _items: Json; _payment_method: string; _user_id: string }
        Returns: string
      }
      purchase_plan: {
        Args: { _payment_method: string; _plan_id: string }
        Returns: string
      }
      redeem_coupon: { Args: { _code: string }; Returns: number }
      refund_booking_credit: {
        Args: { p_booking_id: string; p_reason: string }
        Returns: undefined
      }
      staff_worked_seconds: {
        Args: { _from: string; _staff_id: string; _to: string }
        Returns: number
      }
      token_balance: { Args: { _user_id: string }; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user" | "staff" | "coach"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "staff", "coach"],
    },
  },
} as const
